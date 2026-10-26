import test from 'node:test'
import assert from 'node:assert/strict'

import { JoinAttemptRegistry, joinAttemptRegistry } from 'wanxiangli/handle-lifecycle'

test('SPEC[join-attempt-1] acquire grants exclusive lease and refuses duplicate acquire with AlreadyAcquired', () => {
  const reg = new JoinAttemptRegistry()
  const first = reg.acquire('session-A', 'attempt-1')
  assert.equal(first.acquired, true)
  assert.equal(first.targetSessionId, 'session-A')
  assert.equal(first.attemptId, 'attempt-1')
  assert.equal(reg.isAcquired('session-A'), true)

  const duplicate = reg.acquire('session-A', 'attempt-2')
  assert.equal(duplicate.acquired, false)
  assert.equal(duplicate.reason, 'AlreadyAcquired')
  assert.equal(duplicate.existingAttemptId, 'attempt-1')

  // Different session is independent
  const other = reg.acquire('session-B', 'attempt-3')
  assert.equal(other.acquired, true)
})

test('SPEC[join-attempt-2] release is idempotent and allows re-acquire', () => {
  const reg = new JoinAttemptRegistry()
  reg.acquire('session-A', 'attempt-1')
  assert.equal(reg.isAcquired('session-A'), true)

  const rel1 = reg.release('session-A', 'attempt-1')
  assert.equal(rel1.released, true)
  assert.equal(reg.isAcquired('session-A'), false)

  // Idempotent duplicate release
  const rel2 = reg.release('session-A', 'attempt-1')
  assert.equal(rel2.released, true)

  // Re-acquire succeeds
  const re = reg.acquire('session-A', 'attempt-2')
  assert.equal(re.acquired, true)
  assert.equal(re.attemptId, 'attempt-2')
})

test('SPEC[join-attempt-3] signalVisibleUserMessage without active lease deduplicates and drops wake', () => {
  const reg = new JoinAttemptRegistry()
  const out1 = reg.signalVisibleUserMessage('session-A', 'msg-1')
  assert.equal(out1.woken, false)
  assert.equal(out1.reason, 'NoActiveLease')
  assert.equal(reg.hasSeenMessage('session-A', 'msg-1'), true)

  // Later acquire is NOT retroactively woken by prior buffered messages (existing contract)
  const acq = reg.acquire('session-A', 'attempt-1')
  assert.equal(acq.acquired, true)
  const snap = reg.snapshot('session-A')
  assert.equal(snap.woken, false)

  // Prior message resent while acquired is rejected as duplicate and does NOT wake
  const dup = reg.signalVisibleUserMessage('session-A', 'msg-1')
  assert.equal(dup.woken, false)
  assert.equal(dup.reason, 'DuplicateMessage')
  assert.equal(reg.snapshot('session-A').woken, false)
})

test('SPEC[join-attempt-4] signalVisibleUserMessage with active lease wakes immediately once and rejects duplicate receipt', () => {
  const reg = new JoinAttemptRegistry()
  reg.acquire('session-A', 'attempt-1')

  const wake = reg.signalVisibleUserMessage('session-A', 'msg-fresh')
  assert.equal(wake.woken, true)
  assert.equal(wake.reason, 'UserMessageArrived')
  assert.equal(wake.attemptId, 'attempt-1')
  assert.equal(reg.snapshot('session-A').woken, true)

  // Resending same message ID is duplicate and does NOT re-wake
  const dup = reg.signalVisibleUserMessage('session-A', 'msg-fresh')
  assert.equal(dup.woken, false)
  assert.equal(dup.reason, 'DuplicateMessage')

  // After release, a new attempt cannot be woken by the previously seen message
  reg.release('session-A', 'attempt-1')
  reg.acquire('session-A', 'attempt-2')
  const retryOld = reg.signalVisibleUserMessage('session-A', 'msg-fresh')
  assert.equal(retryOld.woken, false)
  assert.equal(retryOld.reason, 'DuplicateMessage')
  assert.equal(reg.snapshot('session-A').woken, false)

  // Fresh message wakes the new attempt
  const wake2 = reg.signalVisibleUserMessage('session-A', 'msg-new')
  assert.equal(wake2.woken, true)
  assert.equal(wake2.attemptId, 'attempt-2')
})

test('SPEC[join-attempt-5] clearSession removes lease and seen messages without affecting other sessions', () => {
  const reg = new JoinAttemptRegistry()
  reg.acquire('session-A', 'attempt-A')
  reg.signalVisibleUserMessage('session-A', 'msg-A')

  reg.acquire('session-B', 'attempt-B')
  reg.signalVisibleUserMessage('session-B', 'msg-B')

  const clr = reg.clearSession('session-A')
  assert.equal(clr.cleared, true)
  assert.equal(clr.droppedLease, true)
  assert.equal(clr.droppedMessagesCount, 1)

  assert.equal(reg.isAcquired('session-A'), false)
  assert.equal(reg.hasSeenMessage('session-A', 'msg-A'), false)

  // Session B is completely untouched
  assert.equal(reg.isAcquired('session-B'), true)
  assert.equal(reg.hasSeenMessage('session-B', 'msg-B'), true)
})

test('SPEC[join-attempt-6] global singleton joinAttemptRegistry is an isolated instance and handles malformed inputs', () => {
  assert.ok(joinAttemptRegistry instanceof JoinAttemptRegistry)
  assert.throws(() => joinAttemptRegistry.acquire(null, 'att'), /targetSessionId/)
  assert.throws(() => joinAttemptRegistry.acquire('sid', ''), /attemptId/)
  assert.throws(() => joinAttemptRegistry.signalVisibleUserMessage('sid', null), /messageId/)
  assert.throws(() => joinAttemptRegistry.clearSession(''), /targetSessionId/)

  // Clean isolation on singleton
  joinAttemptRegistry.clearSession('singleton-test')
  const acq = joinAttemptRegistry.acquire('singleton-test', 'att-1')
  assert.equal(acq.acquired, true)
  joinAttemptRegistry.clearSession('singleton-test')
  assert.equal(joinAttemptRegistry.isAcquired('singleton-test'), false)
})
