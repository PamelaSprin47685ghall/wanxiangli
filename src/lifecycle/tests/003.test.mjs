import test from 'node:test'
import assert from 'node:assert/strict'
import { Rig, reachReady } from './support.mjs'

test('SPEC[lifecycle-003] the same request replays and a different body conflicts', () => {
  const rig = new Rig()
  const command = { type: 'Review', office: 'Plan', providerRunId: 'run-1', toolCallId: 'call-1', updates: [] }
  const first = rig.apply(command, 'review-1')
  const replay = rig.call(command, 'review-1')
  assert.equal(replay.status, 'Replayed')
  assert.equal(replay.record, null)
  assert.deepEqual(replay.result, first)
  assert.equal(rig.count, 1)
  const conflict = rig.call({ ...command, updates: [{ key: 'gap', value: 'fix' }] }, 'review-1')
  assert.equal(conflict.status, 'Conflict')
  assert.equal(conflict.reason, 'RequestIdConflict')
  assert.equal(rig.count, 1)
})

test('SPEC[lifecycle-003] the same tool call on another request returns the original result', () => {
  const rig = new Rig()
  const command = { type: 'Review', office: 'Plan', providerRunId: 'run-1', toolCallId: 'call-1', updates: [{ key: 'gap', value: 'fix' }] }
  const first = rig.apply(command, 'review-1')
  const again = rig.call({ ...command, providerRunId: 'run-2' }, 'review-2')
  assert.equal(again.status, 'Observed')
  assert.deepEqual(again.result, first)
  assert.equal(rig.count, 1)
  const replay = rig.call({ ...command, providerRunId: 'run-2' }, 'review-2')
  assert.equal(replay.status, 'Replayed')
  assert.equal(rig.count, 1)
})

test('SPEC[lifecycle-003] unknown fields, empty keys, a fixed office and a foreign command are refused', () => {
  const rig = new Rig()
  assert.throws(() => rig.review([], { snapshotId: 'nope' }), /Unknown field/)
  assert.throws(() => rig.review([{ key: '', value: 'x' }]), /empty/)
  rig.review([{ key: 'gap', value: 'fix' }])
  const moved = rig.call({ type: 'Review', office: 'Manager', providerRunId: 'run-1', toolCallId: 'other', updates: [] })
  assert.equal(moved.status, 'Conflict')
  assert.equal(moved.reason, 'Office is fixed')
  assert.throws(() => rig.call({ type: 'Deliver', incumbencyId: 'x' }), /Unknown work command/)
  assert.equal(rig.work.inspect().obligations.length, 1)
})

test('SPEC[lifecycle-003] 待执行 rejects a non-empty ledger', () => {
  const rig = new Rig()
  reachReady(rig)
  const refused = rig.call({ type: 'Review', office: 'Plan', providerRunId: 'run-1', toolCallId: 'filled', updates: [{ key: 'gap', value: 'fix' }] })
  assert.equal(refused.status, 'Conflict')
  assert.equal(refused.reason, 'Ready accepts only an empty review')
  assert.equal(rig.work.inspect().phase, 'Ready')
})
