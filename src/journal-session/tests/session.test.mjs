import assert from 'node:assert/strict'
import test from 'node:test'
import { JournalSession } from 'wanxiangli/journal-session'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const committed = (sequence, envelope = {}) => ({ kind: 'Committed', eventId: `event-${sequence}`, sequence, envelope })
function fixture(options = {}) {
  let current = { facts: [] }
  let reads = 0
  const settlements = []
  const close = Promise.resolve()
  const writer = {
    append: async request => request,
    isPoisoned: () => false,
    release() {},
    releaseAsync: () => close,
    ...options.writer,
  }
  const session = new JournalSession({
    writer, initialRevision: 0n,
    readCurrent: () => { reads += 1; return current },
    refreshCurrent: () => { current = { facts: ['external'] }; return { refreshed: true } },
    onSettlement: result => settlements.push(result),
    ...options.session,
  })
  return { session, writer, settlements, reads: () => reads, current: () => current }
}

test('JournalSession reads the original Current and publishes the committed bigint sequence', async () => {
  const f = fixture()
  assert.equal(f.reads(), 0)
  assert.equal(f.session.snapshot(), f.current())
  assert.equal(f.session.snapshotWithRevision().current, f.current())
  const envelope = { original: true }
  const sequence = 9007199254740993n
  let dispose = 0
  const waiting = f.session.awaitChange(0n, () => () => { dispose += 1 })
  const result = await f.session.append(committed(sequence, envelope))
  assert.equal(result.current, f.current())
  assert.equal(result.envelope, envelope)
  assert.equal(result.sequence, sequence)
  const change = await waiting
  assert.equal(change.envelope, envelope)
  assert.equal(change.revision, sequence)
  assert.equal(dispose, 1)
  assert.deepEqual(f.session.snapshotWithRevision(), { current: f.current(), revision: sequence })
  const alreadyChanged = await f.session.awaitChange(0n, () => assert.fail('a later change is checked before registration'))
  assert.equal(alreadyChanged, change)
  assert.equal(f.session.releaseAsync(), f.writer.releaseAsync())
  assert.deepEqual(f.settlements, [])
})

test('JournalSession registers before cancellation and cancellation does not consume the next change', async () => {
  const f = fixture()
  const order = []
  const cancelled = f.session.awaitChange(0n, cancel => {
    order.push('register')
    cancel()
    return () => order.push('dispose')
  })
  assert.equal(await cancelled, null)
  assert.deepEqual(order, ['register', 'dispose'])
  let cancelFuture
  const future = f.session.awaitChange(4n, cancel => { cancelFuture = cancel; return () => order.push('future disposed') })
  const next = f.session.awaitChange(0n)
  await f.session.append(committed(2n))
  assert.equal((await next).revision, 2n)
  cancelFuture()
  assert.equal(await future, null)
  assert.equal(order.at(-1), 'future disposed')
})

test('JournalSession preserves rejected outcomes and refreshes Current without publishing a revision', async () => {
  const f = fixture()
  const originalFailure = { original: new Error('original failure') }
  const outcomes = [
    { kind: 'Rejected', eventId: 'cut', reason: 'cut' },
    { kind: 'CommitUnknown', eventId: 'unknown', error: originalFailure },
    { kind: 'NoNewWriteReleaseFailed', eventId: 'release', error: originalFailure },
    { kind: 'NotAttempted', eventId: 'refused', unavailable: originalFailure },
  ]
  let cancel
  const pending = f.session.awaitChange(0n, stop => { cancel = stop; return () => {} })
  for (const outcome of outcomes) assert.equal(await f.session.append(outcome), outcome)
  assert.deepEqual(f.settlements, outcomes)
  assert.equal(f.reads(), 0)
  assert.equal(f.session.revision(), 0n)
  assert.deepEqual(f.session.refreshCurrent(), { refreshed: true })
  assert.equal(f.session.snapshot(), f.current())
  assert.deepEqual(f.session.snapshot().facts, ['external'])
  assert.equal(f.session.revision(), 0n)
  cancel()
  assert.equal(await pending, null)
})

test('JournalSession leaves settlement and Current callback exceptions unchanged', async () => {
  const cause = new Error('settlement callback failed')
  const f = fixture({ session: { onSettlement() { throw cause } } })
  await assert.rejects(f.session.append({ kind: 'Rejected', eventId: 'cut', reason: 'cut' }), error => error === cause)
  assert.equal(f.session.revision(), 0n)
  const readCause = new Error('Current failed')
  const unreadable = fixture({ session: { readCurrent() { throw readCause } } })
  await assert.rejects(unreadable.session.append(committed(2n)), error => error === readCause)
  assert.equal(unreadable.session.revision(), 0n)
})

test('JournalSession starts recovery once and the next generation waits for its predecessor', async () => {
  const f = fixture()
  await f.session.runOrAwaitRecovery()
  const first = deferred()
  const second = deferred()
  const firstStarted = deferred()
  const secondStarted = deferred()
  const starts = []
  f.session.enqueueRecovery(() => { starts.push('first'); firstStarted.resolve(); return first.promise })
  assert.deepEqual(starts, [])
  const firstRun = f.session.runOrAwaitRecovery()
  assert.equal(f.session.runOrAwaitRecovery(), firstRun)
  await firstStarted.promise
  assert.deepEqual(starts, ['first'])
  f.session.enqueueRecovery(() => { starts.push('second'); secondStarted.resolve(); return second.promise })
  const secondRun = f.session.runOrAwaitRecovery()
  assert.equal(f.session.runOrAwaitRecovery(), secondRun)
  assert.deepEqual(starts, ['first'])
  first.resolve()
  await firstRun
  await secondStarted.promise
  assert.deepEqual(starts, ['first', 'second'])
  second.resolve()
  await secondRun
  f.session.enqueueRecovery(async () => { starts.push('third') })
  await f.session.runOrAwaitRecovery()
  assert.deepEqual(starts, ['first', 'second', 'third'])
})

test('JournalSession shares a recovery failure and retries only on a later call', async () => {
  const f = fixture()
  const first = deferred()
  const cause = new Error('recovery failed')
  let starts = 0
  f.session.enqueueRecovery(() => { starts += 1; return starts === 1 ? first.promise : Promise.resolve() })
  const firstRun = f.session.runOrAwaitRecovery()
  const otherWaiter = f.session.runOrAwaitRecovery()
  assert.equal(otherWaiter, firstRun)
  const rejected = [firstRun, otherWaiter].map(work => assert.rejects(work, error => error === cause))
  first.reject(cause)
  await Promise.all(rejected)
  assert.equal(starts, 1)
  const retry = f.session.runOrAwaitRecovery()
  assert.notEqual(retry, firstRun)
  await retry
  assert.equal(starts, 2)
  assert.equal(f.session.runOrAwaitRecovery(), retry)
})

test('JournalSession lets a new generation recover after its predecessor fails', async () => {
  const f = fixture()
  const first = deferred()
  const cause = new Error('recovery failed')
  f.session.enqueueRecovery(() => first.promise)
  const firstRun = f.session.runOrAwaitRecovery()
  const rejectedFirst = assert.rejects(firstRun, error => error === cause)
  const second = deferred()
  const secondStarted = deferred()
  f.session.enqueueRecovery(() => { secondStarted.resolve(); return second.promise })
  const secondRun = f.session.runOrAwaitRecovery()
  first.reject(cause)
  await rejectedFirst
  await secondStarted.promise
  assert.equal(f.session.runOrAwaitRecovery(), secondRun)
  second.resolve()
  await secondRun
})
