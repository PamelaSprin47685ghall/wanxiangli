import assert from 'node:assert/strict'
import { JournalWriter, JournalSession } from 'wanxiangli/journal-session'

const initialization = { kind: 'initialization' }
const commits = []
let current = { title: null }
let identities = 0
let observations = 0
const writer = new JournalWriter({
  initialization: { eventId: 'init', envelope: initialization },
  newEventId: () => `event-${++identities}`,
  now: () => ++observations,
  makeEnvelope: input => input,
  commitEnvelope: async envelope => {
    commits.push(envelope)
    if (envelope !== initialization) current = { title: envelope.request.title }
    return { ok: true, value: { cuts: [] } }
  },
})
const session = new JournalSession({
  writer, initialRevision: writer.lastCommittedLocalSeq(),
  readCurrent: () => current,
  refreshCurrent: () => ({ ok: true }),
})
assert.equal(commits.length, 0)
assert.equal(observations, 0)
assert.equal(session.snapshot(), current)
let unregistered = 0
const waiting = session.awaitChange(0n, () => () => { unregistered += 1 })
const appended = await session.append({ title: 'installed consumer' })
assert.equal(appended.kind, 'Committed')
assert.equal(appended.sequence, 2n)
assert.equal(appended.current, current)
assert.equal(commits[0], initialization)
assert.equal(commits[1], appended.envelope)
const change = await waiting
assert.equal(change.revision, 2n)
assert.equal(change.envelope, appended.envelope)
assert.equal(unregistered, 1)
assert.deepEqual(session.snapshotWithRevision(), { current, revision: 2n })
assert.equal(observations, 1)
let recoveries = 0
session.enqueueRecovery(async () => { recoveries += 1 })
const recovery = session.runOrAwaitRecovery()
assert.equal(session.runOrAwaitRecovery(), recovery)
await recovery
session.enqueueRecovery(async () => { recoveries += 1 })
await session.runOrAwaitRecovery()
assert.equal(recoveries, 2)
const closing = session.releaseAsync()
assert.equal(session.releaseAsync(), closing)
assert.equal(writer.releaseAsync(), closing)
await closing
const refused = await session.append({ title: 'after close' })
assert.equal(refused.kind, 'NotAttempted')
assert.equal(refused.unavailable.kind, 'WriterDisposed')
assert.equal(identities, 2)
assert.equal(commits.length, 2)
console.log(JSON.stringify({ journalSession: true }))
