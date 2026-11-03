import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { FileBaseline, FileDiff } from 'wanxiangli/file-baseline'
import {
  CasebookSettlementOwner, BookkeeperStaging, BookkeeperLedger, BookkeeperTransaction, CasebookState, CasebookIndexLaw,
  CasebookService, CasebookIndex, SessionDraftStore,
  normalizeObservations, sameObservations,
} from 'wanxiangli/casebook'

const diff = new FileDiff()
assert.equal(diff.fileDiff('unchanged', 'same\n', 'same\n'), '')
assert.deepEqual(diff.summarize(['first', 'second']), { diffSummary: 'firstsecond', refresh: true })
assert.equal(diff.truncate('short', 20).text, 'short')
const reported = []
const owner = new CasebookSettlementOwner(incident => { reported.push(incident); throw new Error('report failed') })
const incident = { message: 'case conflict' }
assert.equal(owner.Observe('event', 'SemanticCut', incident), 'CaseUnavailable')
assert.equal(owner.Observe('event', 'SemanticCut', { message: 'another object' }), 'CaseUnavailableKnown')
assert.deepEqual(reported, [incident])
assert.equal(owner.Redeliver('event', incident), 'CaseUnavailableKnown')
assert.throws(() => new CasebookSettlementOwner(() => {}).Redeliver('event', incident), /original settled owner/)

const staging = new BookkeeperStaging()
staging.beginTransaction('edit', 'old question', 'old answer')
const created = staging.edit('edit', key => key)
assert.equal(created.tag, 0)
const edit = created.fields[0]
const program = Function('api', `return new (${edit.runtimeBaseClass})(api)`)(edit.api)
assert.equal(program.question([['begin', 'end', 'question']]).text('begin', 'end'), 'question')
program.setQuestion('new question')
program.setAnswer('new answer')
assert.equal(program.question().text(), 'old question')
assert.deepEqual(staging.snapshot('edit').fields[0], ['old question', 'old answer'])
assert.equal(edit.commit().tag, 0)
assert.deepEqual(staging.take('edit').fields[0], ['new question', 'new answer'])

const ledger = new BookkeeperLedger()
const transaction = new BookkeeperTransaction(staging, ledger)
let complete
const written = await transaction.run({ txId: 'transaction', ownerId: 'owner', question: 'Q', answer: 'A' }, {
  async open() { return { ok: true, value: 'child' } },
  subscribe(childId, callback) {
    assert.equal(ledger.txIdFor(childId), 'transaction')
    complete = callback
    return () => {}
  },
  prepare() { return { ok: true, value: { agent: 'agent', text: 'prompt' } } },
  async send(childId, agent, text) {
    assert.equal(ledger.tryConsume(childId, agent, text), true)
    const edit = staging.edit('transaction', key => key).fields[0]
    edit.api.bookkeeper.setQuestion('stored Q')
    edit.api.bookkeeper.setAnswer('stored A')
    assert.equal(edit.commit().tag, 0)
    complete({ ok: true })
    return { ok: true }
  },
  async abort(childId) { assert.equal(ledger.isAttached(childId), true) },
})
assert.deepEqual(written, { ok: true, value: { question: 'stored Q', answer: 'stored A' } })
assert.equal(ledger.isAttached('child'), false)
assert.equal(staging.snapshot('transaction').tag, 1)

const observation = { kind: 'glob-result', pattern: '*', paths: ['z', 'a'] }
const empty = new CasebookState()
const captured = empty.apply({ kind: 'captured', case: {
  identity: 'one', sourceTrace: 'trace', q: 'question', a: 'answer', relatedPaths: ['file'],
  completionFileState: 'completion', maintenanceFileState: 'maintenance', accessOrder: 99n,
  observations: [observation],
} })
const current = captured.apply({ kind: 'accessed', identity: 'one' })
assert.deepEqual(empty.visible(0), { cases: [], victims: [] })
assert.equal(captured.visible(1).cases[0].accessOrder, 0n)
assert.equal(current.visible(1).cases[0].accessOrder, 1n)
const shelfmark = new CasebookIndexLaw().shelfmarkFor('one', 'question')
assert.equal(current.resolve(1, shelfmark).a, 'answer')
assert.deepEqual(normalizeObservations([observation, observation]), [observation])
assert.equal(sameObservations([observation], [{ ...observation, paths: ['a', 'z'] }]), true)

const directory = fs.mkdtempSync(path.join(tmpdir(), 'wanxiangli-file-baseline-consumer-'))
try {
  const stored = new Map()
  const payloads = {
    async read(reference) { return { ok: true, value: stored.has(reference) ? Uint8Array.from(stored.get(reference)) : null } },
    async write(bytes) {
      const reference = 'sha256:' + createHash('sha256').update(bytes).digest('hex')
      stored.set(reference, Uint8Array.from(bytes))
      return { ok: true, value: reference }
    },
  }
  const resolvePath = relativeOrAbsolute => path.resolve(directory, relativeOrAbsolute)
  const service = new FileBaseline({ resolvePath, payloads })
  const original = Buffer.from('\uFEFFbefore\r\n')
  const target = Buffer.from('after\n')
  fs.writeFileSync(resolvePath('subject.txt'), original)
  const paths = ['subject.txt', 'missing.txt']
  const captured = await service.capture(paths)
  assert.equal(captured.ok, true, captured.error)
  const baseline = JSON.parse(captured.value)
  assert.deepEqual(baseline['missing.txt'], { kind: 'Missing' })
  assert.equal(baseline['subject.txt'].kind, 'Present')
  assert.deepEqual(Buffer.from(stored.get(baseline['subject.txt'].payloadRef)), original)
  assert.equal(baseline['subject.txt'].payload_ref, baseline['subject.txt'].payloadRef)
  assert.equal(baseline['subject.txt'].contentHash, baseline['subject.txt'].sha256)

  fs.writeFileSync(resolvePath('subject.txt'), target)
  const compared = await service.compare(paths, captured.value)
  assert.equal(compared.ok, true, compared.error)
  assert.equal(compared.value.refresh, true)
  assert.ok(compared.value.diffSummary.includes('before'))
  assert.ok(compared.value.diffSummary.includes('after'))
  const nextState = JSON.parse(compared.value.targetState)
  assert.deepEqual(Buffer.from(stored.get(nextState['subject.txt'].payloadRef)), target)
  const unchanged = await service.compare(paths, compared.value.targetState)
  assert.equal(unchanged.ok, true, unchanged.error)
  assert.equal(unchanged.value.refresh, false)
  assert.equal(unchanged.value.diffSummary, '')
  fs.writeFileSync(resolvePath('subject.txt'), 'later edit')
  assert.deepEqual(Buffer.from(stored.get(nextState['subject.txt'].payloadRef)), target)

  const drafts = new SessionDraftStore()
  const caseIndex = new CasebookIndex()
  let cases = new CasebookState()
  let transactions = 0
  const caseService = new CasebookService(drafts, caseIndex, {
    current() { return { ok: true, value: cases } },
    async appendCaptured(value) { cases = cases.apply({ kind: 'captured', case: value }); return { ok: true } },
    async appendRefreshed(value) { cases = cases.apply({ kind: 'refreshed', ...value }); return { ok: true } },
    async appendAccessed(identity) { cases = cases.apply({ kind: 'accessed', identity }); return { ok: true } },
  }, service, request => {
    const txId = 'service-' + (++transactions)
    let done
    return transaction.run({ txId, ownerId: request.identity, question: request.question, answer: request.answer }, {
      async open() { return { ok: true, value: txId } },
      subscribe(_child, complete) { done = complete; return () => {} },
      prepare() { return { ok: true, value: { agent: 'agent', text: request.transcript } } },
      async send() {
        const edit = staging.edit(txId, key => key).fields[0]
        edit.api.bookkeeper.setAnswer(request.kind === 'finalize' ? 'saved answer' : 'maintained answer')
        assert.equal(edit.commit().tag, 0)
        done({ ok: true })
        return { ok: true }
      },
      async abort() {},
    })
  }, () => [{ kind: 'file-read', path: 'subject.txt', contentHash: 'observed' }], () => true)
  drafts.setQ('case', 'saved question')
  drafts.setA('case', 'draft answer')
  assert.deepEqual(await caseService.finalizeDraft('case'), { kind: 'finalized', identity: 'case' })
  const savedCompletion = cases.visible(0).cases[0].completionFileState
  const caseShelfmark = caseIndex.tryGet().cases[0].shelfmark
  assert.deepEqual(await caseService.fetch(caseShelfmark, () => assert.fail('unexpected append failure')), { kind: 'fresh', answer: 'saved answer' })
  fs.writeFileSync(resolvePath('subject.txt'), 'new related content')
  assert.deepEqual(await caseService.fetch(caseShelfmark, () => assert.fail('unexpected append failure')), { kind: 'refreshed', answer: 'maintained answer' })
  assert.equal(transactions, 2)
  assert.equal(cases.visible(0).cases[0].completionFileState, savedCompletion)
  assert.notEqual(cases.visible(0).cases[0].maintenanceFileState, savedCompletion)

  const readError = 'consumer payload read failure'
  const failed = new FileBaseline({ resolvePath, payloads: { ...payloads, read: async () => ({ ok: false, error: readError }) } })
  const failure = await failed.compare(paths, captured.value)
  assert.equal(failure.ok, false)
  assert.equal(failure.error, readError)
  const rejection = new Error('consumer payload rejection')
  const rejected = new FileBaseline({ resolvePath, payloads: { ...payloads, read: () => Promise.reject(rejection) } })
  await assert.rejects(rejected.compare(paths, captured.value), cause => cause === rejection)
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
console.log('file-baseline consumer passed')
