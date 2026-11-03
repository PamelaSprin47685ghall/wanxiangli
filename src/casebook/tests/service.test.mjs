import test from 'node:test'
import assert from 'node:assert/strict'
import { CasebookService, CasebookState, CasebookIndex, SessionDraftStore, cleanupCasebookDraft, archiveCase, finalizeCase, finalizeCaptured, refreshWithDiff } from '../../../dist/casebook/CasebookIndexLaw.js'

const ok = value => ({ ok: true, value })
const error = value => ({ ok: false, error: value })
const read = (path = 'file', contentHash = 'hash') => ({ kind: 'file-read', path, contentHash })
const record = (identity = 'case', more = {}) => ({
  identity, sourceTrace: identity, q: 'Q', a: 'old A', relatedPaths: ['file'],
  completionFileState: 'completion', maintenanceFileState: 'maintenance', accessOrder: 0n,
  observations: [read()], ...more,
})

function setup(initial = []) {
  const drafts = new SessionDraftStore()
  const index = new CasebookIndex()
  const log = []
  let state = initial.reduce((state, value) => state.apply({ kind: 'captured', case: value }), new CasebookState())
  let observations = [read('z'), read('a'), read('z')]
  let enabled = true
  const store = {
    current() { log.push('current'); return ok(state) },
    async appendCaptured(value) { log.push(['capture', value]); state = state.apply({ kind: 'captured', case: value }); return ok() },
    async appendRefreshed(value) { log.push(['refresh', value]); state = state.apply({ kind: 'refreshed', ...value }); return ok() },
    async appendAccessed(identity) { log.push(['access', identity]); state = state.apply({ kind: 'accessed', identity }); return ok() },
  }
  const baseline = {
    async capture(paths) { log.push(['freeze', paths]); return ok('captured baseline') },
    async compare(paths, previous) {
      log.push(['compare', paths, previous])
      return ok({ refresh: false, targetState: 'target', diffSummary: 'diff' })
    },
  }
  const operations = {
    async run(request) { log.push(['bookkeeper', request]); return ok({ question: 'canonical Q', answer: 'new A' }) },
    drain(identity) { log.push(['drain', identity]); const drained = observations; observations = []; return drained },
    enabled() { log.push('enabled'); return enabled },
  }
  const service = new CasebookService(drafts, index, store, baseline, request => operations.run(request), identity => operations.drain(identity), () => operations.enabled())
  return {
    drafts, index, store, baseline, operations, service, log,
    get state() { return state }, set state(value) { state = value },
    set enabled(value) { enabled = value },
    seedDraft() { drafts.setQ('case', 'Q1'); drafts.setA('case', 'A1'); drafts.setQ('case', 'Q2'); drafts.setA('case', 'A2') },
    shelfmark() { return index.shelfmarkFor('case', 'Q') },
  }
}

test('finalize consumes the draft before lookup, saves normalized observations, and publishes the index', async () => {
  const f = setup()
  f.seedDraft()
  const readCurrent = f.store.current
  f.store.current = () => { assert.equal(f.drafts.tryTake('case'), undefined); return readCurrent() }
  assert.deepEqual(await f.service.finalizeDraft('case'), { kind: 'finalized', identity: 'case' })
  assert.deepEqual(f.log.map(item => Array.isArray(item) ? item[0] : item), ['enabled', 'drain', 'current', 'bookkeeper', 'freeze', 'current', 'capture', 'current'])
  const request = f.log.find(item => item[0] === 'bookkeeper')[1]
  assert.equal(request.question, 'Q2')
  assert.equal(request.answer, 'A2')
  assert.equal(request.transcript, 'Q1 = Q1\nA1 = A1\nQ2 = Q2\nA2 = A2')
  assert.deepEqual(f.log.find(item => item[0] === 'freeze')[1], ['a', 'z'])
  const saved = f.state.visible(0).cases[0]
  assert.equal(saved.sourceTrace, 'case')
  assert.equal(saved.completionFileState, saved.maintenanceFileState)
  assert.equal(saved.a, 'new A')
  assert.deepEqual(saved.observations, [read('a'), read('z')])
  assert.equal(f.index.tryGet().cases[0].question, 'canonical Q')
})

test('disabled, absent and unanswered drafts drain without reading or invoking a bookkeeper', async () => {
  for (const mode of ['disabled', 'absent', 'unanswered']) {
    const f = setup()
    if (mode === 'disabled') { f.seedDraft(); f.enabled = false }
    if (mode === 'unanswered') f.drafts.setQ('case', 'Q')
    assert.deepEqual(await f.service.finalizeDraft('case'), { kind: 'nothing-to-finalize', identity: 'case' })
    assert.deepEqual(f.log, ['enabled', ['drain', 'case']])
    assert.equal(f.drafts.tryTake('case'), undefined)
  }
  const f = setup()
  f.seedDraft()
  cleanupCasebookDraft(f.drafts, identity => f.operations.drain(identity), 'case')
  assert.equal(f.drafts.tryTake('case'), undefined)
  assert.deepEqual(f.log, [['drain', 'case']])
})

test('existence checks run both before Bookkeeper and before Capture', async () => {
  const first = setup([record()])
  first.seedDraft()
  assert.deepEqual(await first.service.finalizeDraft('case'), { kind: 'phase-conflict', identity: 'case', reason: 'case already finalized for scope case' })
  assert.deepEqual(first.log, ['enabled', ['drain', 'case'], 'current'])

  const race = setup()
  race.seedDraft()
  race.baseline.capture = async () => { race.state = race.state.apply({ kind: 'captured', case: record() }); return ok('baseline') }
  assert.equal((await race.service.finalizeDraft('case')).kind, 'phase-conflict')
  assert.equal(race.log.filter(item => item[0] === 'capture').length, 0)
  assert.equal(race.state.visible(0).cases[0].a, 'old A')
})

test('failed preparation consumes the draft, while append failure keeps the entire original object', async () => {
  const freeze = setup()
  freeze.seedDraft()
  freeze.baseline.capture = async () => error('read failed')
  assert.deepEqual(await freeze.service.finalizeDraft('case'), { kind: 'not-committed', identity: 'case', reason: 'freeze baseline failed: read failed' })
  assert.equal(freeze.drafts.tryTake('case'), undefined)
  assert.equal(freeze.state.visible(0).cases.length, 0)

  const failure = { EventId: {}, Error: { Prepared: {}, cause: new Error('write uncertain') } }
  const append = setup()
  append.seedDraft()
  append.store.appendCaptured = async () => error(failure)
  const settled = await append.service.finalizeDraft('case')
  assert.equal(settled.kind, 'persistence-failed')
  assert.equal(settled.failure, failure)
  assert.equal(settled.failure.Error.Prepared, failure.Error.Prepared)
  assert.equal(append.index.tryGet(), null)
})

test('an index failure after Capture is unknown and does not undo the stored case', async () => {
  const f = setup()
  f.seedDraft()
  f.index.freeze = () => { throw new Error('index unavailable') }
  assert.deepEqual(await f.service.finalizeDraft('case'), { kind: 'unknown', identity: 'case', reason: 'index unavailable' })
  assert.equal(f.state.visible(0).cases.length, 1)
  assert.equal(f.log.filter(item => item[0] === 'drain').length, 1)
  const rejected = setup()
  rejected.seedDraft()
  rejected.operations.run = async () => { throw new Error('bookkeeper rejected') }
  assert.deepEqual(await rejected.service.finalizeDraft('case'), { kind: 'unknown', identity: 'case', reason: 'bookkeeper rejected' })
  assert.equal(rejected.log.filter(item => item[0] === 'drain').length, 2)
  const outer = setup()
  outer.operations.drain = () => { throw new Error('outer drain') }
  await assert.rejects(outer.service.finalizeDraft('case'), /outer drain/)
})

test('fresh fetch touches once and checks the feature at the actual access time', async () => {
  const f = setup([record()])
  f.baseline.compare = async () => { f.enabled = false; return ok({ refresh: false, targetState: 'not used', diffSummary: '' }) }
  assert.deepEqual(await f.service.fetch(f.shelfmark(), () => assert.fail('no append failed')), { kind: 'fresh', answer: 'old A' })
  assert.equal(f.log.filter(item => item[0] === 'bookkeeper' || item[0] === 'access').length, 0)
  assert.equal(f.log.filter(item => item === 'enabled').length, 1)
  f.enabled = true
  f.baseline.compare = async () => ok({ refresh: false, targetState: '', diffSummary: '' })
  assert.equal((await f.service.fetch(f.shelfmark(), () => {})).kind, 'fresh')
  assert.equal(f.log.filter(item => item[0] === 'access').length, 1)
})

test('maintenance uses one target capture and serves the newly stored answer', async () => {
  const f = setup([record('case', { relatedPaths: [], observations: [read('z'), read('a')] })])
  let compares = 0
  f.baseline.compare = async (paths, previous) => {
    compares++
    assert.deepEqual(paths, ['a', 'z'])
    assert.equal(previous, 'maintenance')
    return ok({ refresh: true, targetState: 'captured once', diffSummary: 'actual diff' })
  }
  f.operations.run = async request => {
    assert.equal(request.kind, 'refresh')
    assert.equal(request.transcript, 'actual diff')
    return ok({ question: request.question, answer: 'maintained A' })
  }
  assert.deepEqual(await f.service.fetch(f.shelfmark(), () => {}), { kind: 'refreshed', answer: 'maintained A' })
  assert.equal(compares, 1)
  assert.equal(f.state.visible(0).cases[0].maintenanceFileState, 'captured once')
  assert.equal(f.state.visible(0).cases[0].completionFileState, 'completion')
  assert.equal(f.log.filter(item => item[0] === 'refresh').length, 1)
  assert.equal(f.log.filter(item => item[0] === 'access').length, 1)
})

test('an uncertain Refresh keeps the cached answer and notifies the original failure even if Current advanced', async () => {
  const f = setup([record()])
  const failure = { operation: 'Refresh', Prepared: {}, cause: new Error('unknown') }
  const notices = []
  f.baseline.compare = async () => ok({ refresh: true, targetState: 'next', diffSummary: 'diff' })
  f.store.appendRefreshed = async change => { f.state = f.state.apply({ kind: 'refreshed', ...change }); return error(failure) }
  assert.deepEqual(await f.service.fetch(f.shelfmark(), value => notices.push(value)), { kind: 'stale', answer: 'old A' })
  assert.equal(f.state.visible(0).cases[0].a, 'new A')
  assert.equal(notices[0], failure)
  assert.equal(f.log.filter(item => item[0] === 'access').length, 0)
})

test('missing post-refresh lookup serves stale, and Access failure preserves fresh output and notification identity', async () => {
  const gone = setup([record()])
  gone.baseline.compare = async () => ok({ refresh: true, targetState: 'next', diffSummary: 'diff' })
  gone.store.appendRefreshed = async () => { gone.state = new CasebookState(); return ok() }
  assert.deepEqual(await gone.service.fetch(gone.shelfmark(), () => {}), { kind: 'stale', answer: 'old A' })

  const access = setup([record()])
  const failure = { EventId: {}, Error: { kind: 'access failure' } }
  const notices = []
  access.store.appendAccessed = async () => error(failure)
  assert.deepEqual(await access.service.fetch(access.shelfmark(), value => notices.push(value)), { kind: 'fresh', answer: 'old A' })
  assert.equal(notices[0], failure)
  const notification = new Error('notification failed')
  await assert.rejects(access.service.fetch(access.shelfmark(), () => { throw notification }), cause => cause === notification)
})

test('touch catches rejection while refresh and fetch preserve it; unavailable and missing remain distinct', async () => {
  const f = setup([record()])
  const rejection = new Error('append rejection')
  f.store.appendAccessed = async () => { throw rejection }
  assert.deepEqual(await f.service.touch('case'), error({ kind: 'preparation-rejected', reason: 'append rejection' }))
  f.baseline.compare = async () => { throw rejection }
  await assert.rejects(f.service.refresh('case'), cause => cause === rejection)
  await assert.rejects(f.service.fetch(f.shelfmark(), () => {}), cause => cause === rejection)
  f.store.current = () => error('read unavailable')
  assert.deepEqual(await f.service.fetch('x', () => {}), { kind: 'unavailable' })
  f.store.current = () => ok(new CasebookState())
  assert.deepEqual(await f.service.fetch('x', () => {}), { kind: 'missing' })
})

test('direct archive and existing-case refresh retain their original precheck and index behavior', async () => {
  const f = setup()
  assert.equal((await archiveCase(f.store, record())).ok, true)
  assert.equal(f.index.tryGet(), null)
  assert.deepEqual(await finalizeCase(f.store, record()), error({ kind: 'already-finalized', identity: 'case' }))
  assert.deepEqual(await refreshWithDiff(f.store, { identity: 'absent', q: '', a: '', maintenanceFileState: 'next' }), error({ kind: 'case-missing', identity: 'absent' }))
  assert.equal((await refreshWithDiff(f.store, { identity: 'case', q: 'Q2', a: 'A2', maintenanceFileState: 'next' })).ok, true)
  assert.deepEqual(f.state.visible(0).cases[0].relatedPaths, ['file'])
  assert.equal(f.state.visible(0).cases[0].completionFileState, 'completion')
  assert.equal(f.index.tryGet(), null)
  assert.deepEqual(await finalizeCaptured(f.store, f.index, record('other')), { kind: 'finalized', identity: 'other' })
  assert.equal(f.index.tryGet().cases.length, 2)
})
