import test from 'node:test'
import assert from 'node:assert/strict'
import { JournalWriter } from 'wanxiangli/journal-session'

const ok = (cuts = []) => ({ ok: true, value: { cuts } })
const failed = error => ({ ok: false, error })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const cut = (failedEventId, reason = 'semantic cut') => ({ rule: 'Journal', failedEventId, reason, cutEventId: `cut-${failedEventId}` })
function fixture(overrides = {}) {
  const seen = { ids: [], envelopes: [], commits: [], notices: [], clock: [] }
  const initial = { id: 'init', sequence: 1n, fact: 'initialize' }
  let next = 0
  const writer = new JournalWriter({
    initialization: { eventId: 'init', envelope: initial },
    newEventId() { const id = `event-${++next}`; seen.ids.push(id); return id },
    now() { const time = { clock: seen.clock.length }; seen.clock.push(time); return time },
    makeEnvelope(input) { seen.envelopes.push(input); return input },
    commitEnvelope: async envelope => { seen.commits.push(envelope); return overrides.commit ? overrides.commit(envelope, seen) : ok() },
    onSettlement(notice) { seen.notices.push(notice); if (overrides.notice) overrides.notice(notice, writer, seen) },
  })
  return { writer, seen, initial }
}

test('JournalWriter is lazy and allocates request identity before observing time or making its envelope', async () => {
  const { writer, seen, initial } = fixture()
  assert.deepEqual(seen, { ids: [], envelopes: [], commits: [], notices: [], clock: [] })
  assert.equal(writer.localSeq(), 2n)
  assert.equal(writer.lastCommittedLocalSeq(), 0n)
  const request = { fact: 'work' }
  const pending = writer.append(request)
  assert.deepEqual(seen.ids, ['event-1'])
  assert.deepEqual(seen.clock, [])
  assert.deepEqual(seen.envelopes, [])
  const outcome = await pending
  assert.deepEqual(outcome, { kind: 'Committed', eventId: 'event-1', sequence: 2n, envelope: seen.envelopes[0] })
  assert.equal(seen.commits[0], initial)
  assert.equal(seen.commits[1], seen.envelopes[0])
  assert.equal(seen.envelopes[0].request, request)
  assert.equal(seen.envelopes[0].observedAt, seen.clock[0])
  assert.equal(writer.localSeq(), 3n)
  assert.equal(writer.lastCommittedLocalSeq(), 2n)
  await writer.releaseAsync()
})

test('JournalWriter drains accepted appends, closes admission immediately and shares one close promise', async () => {
  const firstEntered = deferred()
  const firstAllowed = deferred()
  const { writer, seen } = fixture({ commit: async envelope => {
    if (envelope.eventId === 'event-1') { firstEntered.resolve(); await firstAllowed.promise }
    return ok()
  } })
  const first = writer.append('first')
  const second = writer.append('second')
  assert.deepEqual(seen.ids, ['event-1', 'event-2'])
  await firstEntered.promise
  assert.equal(seen.clock.length, 1)
  const close = writer.releaseAsync()
  assert.equal(writer.releaseAsync(), close)
  writer.release()
  assert.equal(writer.releaseAsync(), close)
  assert.deepEqual(await writer.append('too late'), { kind: 'NotAttempted', eventId: 'event-3', unavailable: { kind: 'WriterClosing' } })
  firstAllowed.resolve()
  const [firstOutcome, secondOutcome] = await Promise.all([first, second])
  await close
  assert.equal(firstOutcome.sequence, 2n)
  assert.equal(secondOutcome.sequence, 3n)
  assert.equal(seen.clock.length, 2)
  assert.deepEqual(seen.commits.map(envelope => envelope.eventId ?? envelope.id), ['init', 'event-1', 'event-2'])
  assert.deepEqual(await writer.append('closed'), { kind: 'NotAttempted', eventId: 'event-4', unavailable: { kind: 'WriterDisposed' } })
  assert.equal(writer.releaseAsync(), close)
  assert.equal(writer.lastCommittedLocalSeq(), 3n)
})

test('JournalWriter unexpected promise rejection stops its serial prefix and still closes in finally', async () => {
  const rejection = { unexpected: true }
  const { writer, seen } = fixture({ commit: async envelope => {
    if (envelope.eventId === 'event-1') throw rejection
    return ok()
  } })
  const first = writer.append('first')
  const second = writer.append('must not execute')
  const close = writer.releaseAsync()
  const settled = await Promise.allSettled([first, second, close])
  for (const result of settled) { assert.equal(result.status, 'rejected'); assert.equal(result.reason, rejection) }
  assert.equal(writer.isPoisoned(), false)
  assert.equal(writer.localSeq(), 2n)
  assert.equal(writer.lastCommittedLocalSeq(), 1n)
  assert.deepEqual(seen.commits.map(envelope => envelope.eventId ?? envelope.id), ['init', 'event-1'])
  assert.equal((await writer.append('closed')).unavailable.kind, 'WriterDisposed')
  assert.equal(writer.releaseAsync(), close)
})

test('JournalWriter business AppendFailed leaves the writer healthy and reuses the unconsumed sequence', async () => {
  const original = { original: 'pre-write refusal' }
  const error = { kind: 'AppendFailed', reason: 'retry from current facts', original }
  const { writer, seen } = fixture({ commit: async envelope => envelope.eventId === 'event-1' ? failed(error) : ok() })
  assert.deepEqual(await writer.append('refused'), { kind: 'NotAttempted', eventId: 'event-1', unavailable: { kind: 'WriterRefused', reason: error.reason } })
  assert.equal(writer.isPoisoned(), false)
  assert.equal(writer.lastCommittedLocalSeq(), 1n)
  const next = await writer.append('accepted')
  assert.equal(next.kind, 'Committed')
  assert.equal(next.sequence, 2n)
  assert.deepEqual(seen.envelopes.map(envelope => envelope.sequence), [2n, 2n])
  assert.equal(seen.notices.length, 0)
  await writer.releaseAsync()
})

test('JournalWriter receipt self-cut consumes the business sequence without poisoning; unrelated cuts do not reject it', async () => {
  const { writer, seen } = fixture({ commit: async envelope => {
    if (envelope.eventId === 'event-1') return ok([cut('unrelated'), cut('event-1', 'rejected fact')])
    if (envelope.eventId === 'event-2') return ok([cut('unrelated')])
    return ok()
  } })
  assert.deepEqual(await writer.append('cut'), { kind: 'Rejected', eventId: 'event-1', reason: 'rejected fact' })
  assert.equal(writer.isPoisoned(), false)
  assert.equal(writer.localSeq(), 3n)
  assert.equal(writer.lastCommittedLocalSeq(), 2n)
  assert.equal((await writer.append('next')).sequence, 3n)
  assert.equal(seen.notices.length, 0)
  await writer.releaseAsync()
})

for (const kind of ['StorageInvalid', 'AppendNotAttempted', 'CommitUnknown', 'NoNewWriteReleaseFailed', 'SemanticCut']) {
  test(`JournalWriter ${kind} retains the first original error and blocks later commits`, async () => {
    const original = { kind, prepared: { events: [] }, cause: new Error('original failure') }
    const semantic = cut('event-1')
    const error = { kind, original, ...(kind === 'SemanticCut' ? { cut: semantic } : {}) }
    const { writer, seen } = fixture({ commit: async envelope => envelope.eventId ? failed(error) : ok() })
    const result = await writer.append('failed')
    if (kind === 'SemanticCut') assert.deepEqual(result, { kind: 'Rejected', eventId: 'event-1', reason: semantic.reason })
    else if (kind === 'CommitUnknown' || kind === 'NoNewWriteReleaseFailed') {
      assert.equal(result.kind, kind)
      assert.equal(result.error, error)
      assert.equal(result.error.original, original)
    } else {
      assert.equal(result.kind, 'NotAttempted')
      assert.equal(result.unavailable.kind, 'WriterPoisoned')
      assert.equal(result.unavailable.error, error)
    }
    assert.equal(writer.isPoisoned(), true)
    assert.equal(writer.localSeq(), 2n)
    assert.equal(writer.lastCommittedLocalSeq(), 1n)
    const later = await writer.append('later')
    const another = await writer.append('another')
    assert.equal(later.unavailable.kind, 'WriterPoisoned')
    assert.equal(later.unavailable.failedEventId, 'event-1')
    assert.equal(later.unavailable.error, error)
    assert.equal(later.unavailable.error.original, original)
    assert.equal(later.unavailable, another.unavailable)
    assert.equal(seen.commits.length, 2)
    assert.equal(seen.notices.length, 0)
    await writer.releaseAsync()
  })
}

test('JournalWriter initialization self-cut notifies before returning and does not latch poison', async () => {
  const semantic = { ...cut('init', 'cannot initialize'), original: { rawCut: true } }
  let initialCalls = 0
  const { writer, seen } = fixture({
    commit: async envelope => envelope.id === 'init' && initialCalls++ === 0 ? ok([semantic]) : ok(),
    notice(notice, writer) {
      assert.equal(notice.kind, 'initialization-cut')
      assert.equal(notice.cut, semantic)
      assert.equal(writer.isPoisoned(), false)
      assert.equal(writer.lastCommittedLocalSeq(), 0n)
    },
  })
  const result = await writer.append('first')
  assert.equal(seen.notices.length, 1)
  assert.equal(result.kind, 'NotAttempted')
  assert.equal(result.unavailable.failedEventId, 'init')
  assert.equal(result.unavailable.error.kind, 'SemanticCut')
  assert.equal(result.unavailable.error.cut, semantic)
  assert.equal(result.unavailable.error.original, null)
  assert.equal(writer.isPoisoned(), false)
  assert.equal(seen.envelopes.length, 0)
  assert.equal(seen.clock.length, 0)
  assert.equal((await writer.append('retry initialization')).sequence, 2n)
  assert.equal(initialCalls, 2)
  await writer.releaseAsync()
})

for (const kind of ['AppendFailed', 'CommitUnknown']) {
  test(`JournalWriter initialization ${kind} poisons with the initialization identity before notifying`, async () => {
    const error = { kind, original: { cause: new Error('init error') }, ...(kind === 'AppendFailed' ? { reason: 'init refused' } : {}) }
    const { writer, seen } = fixture({
      commit: async () => failed(error),
      notice(notice, writer) { assert.equal(notice.kind, 'initialization-error'); assert.equal(notice.error, error); assert.equal(writer.isPoisoned(), true) },
    })
    const result = await writer.append('not tried')
    assert.equal(result.kind, 'NotAttempted')
    assert.equal(result.unavailable.failedEventId, 'init')
    assert.equal(result.unavailable.error, error)
    assert.equal(writer.lastCommittedLocalSeq(), 0n)
    assert.equal(writer.localSeq(), 2n)
    assert.equal((await writer.append('also not tried')).unavailable.error, error)
    assert.equal(seen.commits.length, 1)
    assert.equal(seen.notices.length, 1)
    assert.equal(seen.clock.length, 0)
    await writer.releaseAsync()
  })
}

test('JournalWriter initialization notice rejection keeps the original cause and does not invent poison', async () => {
  const cause = { fatalNotification: true }
  const { writer } = fixture({ commit: async () => ok([cut('init')]), notice: () => { throw cause } })
  const append = writer.append('first')
  const close = writer.releaseAsync()
  const results = await Promise.allSettled([append, close])
  for (const result of results) { assert.equal(result.status, 'rejected'); assert.equal(result.reason, cause) }
  assert.equal(writer.isPoisoned(), false)
  assert.equal(writer.lastCommittedLocalSeq(), 0n)
})
