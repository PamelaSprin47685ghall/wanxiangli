import test from 'node:test'
import assert from 'node:assert/strict'

import { AdmissionQueue } from 'wanxiangli/admission-queue'

test('SPEC[admission-queue-1] the same physical message reuses the node; a newer physical generation supersedes it', () => {
  const queue = new AdmissionQueue()
  assert.equal(queue.contractVersion, 1)
  assert.equal(queue.bound, 32)
  const first = queue.enqueue('ses-a', 'msg-1', { tag: 1 })
  assert.equal(first.kind, 'Queued')
  assert.equal(first.superseded, null)
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.node))
  assert.deepEqual(first.node.payload, { tag: 1 })
  const again = queue.enqueue('ses-a', 'msg-1', { tag: 2 })
  assert.equal(again.kind, 'Reused')
  assert.equal(again.node, first.node)
  assert.deepEqual(again.node.payload, { tag: 1 }, 'payload is not replaced')
  const other = queue.enqueue('ses-b', 'msg-9', null)
  const newer = queue.enqueue('ses-a', 'msg-2', { tag: 3 })
  assert.equal(newer.kind, 'Queued')
  assert.equal(newer.superseded, first.node)
  assert.ok(newer.node.nodeId > first.node.nodeId && newer.node.fence > first.node.fence)
  assert.deepEqual(queue.snapshot(), [other.node, newer.node], 'the newer generation queues behind ses-b')
  assert.equal(queue.current('ses-a'), newer.node)
  assert.equal(queue.count(), 2)
})

test('SPEC[admission-queue-2] a full queue rejects new sessions but a queued session may change physical generation', () => {
  const queue = new AdmissionQueue(2)
  queue.enqueue('a', '1', null)
  queue.enqueue('b', '1', null)
  const full = queue.enqueue('c', '1', null)
  assert.equal(full.kind, 'Full')
  assert.equal(full.node, null)
  assert.equal(queue.current('c'), null)
  const newer = queue.enqueue('a', '2', null)
  assert.equal(newer.kind, 'Queued')
  assert.equal(newer.superseded.physicalUserMessageId, '1')
  assert.equal(queue.count(), 2)
  assert.throws(() => new AdmissionQueue(0))
  assert.throws(() => new AdmissionQueue(1.5))
  assert.throws(() => queue.enqueue('a', 3, null))
})

test('SPEC[admission-queue-3] only the current node issued by this queue can be taken', () => {
  const queue = new AdmissionQueue()
  const { node } = queue.enqueue('a', '1', null)
  assert.equal(queue.take(null), false)
  assert.equal(queue.take({ ...node }), false, 'a same-shaped copy is not the node')
  const other = new AdmissionQueue()
  other.enqueue('a', '1', null)
  assert.equal(other.take(node), false, 'another queue does not know it')
  const { node: newer } = queue.enqueue('a', '2', null)
  assert.equal(queue.take(node), false, 'a superseded node is stale')
  assert.equal(queue.count(), 1)
  assert.equal(queue.take(newer), true)
  assert.equal(queue.take(newer), false, 'taken once')
  assert.equal(queue.count(), 0)
})

test('SPEC[admission-queue-4] withdraw outcomes and drain order', () => {
  const queue = new AdmissionQueue()
  assert.deepEqual({ ...queue.withdraw('a') }, { outcome: 'AlreadyApplied', node: null })
  const { node } = queue.enqueue('a', '1', null)
  assert.deepEqual({ ...queue.withdraw('a', '0') }, { outcome: 'StaleFence', node: null })
  assert.equal(queue.current('a'), node, 'a late cancel does not touch the newer demand')
  const done = queue.withdraw('a', '1')
  assert.equal(done.outcome, 'Applied')
  assert.equal(done.node, node)
  assert.equal(queue.withdraw('a', '1').outcome, 'AlreadyApplied')
  const b = queue.enqueue('b', '1', null).node
  const c = queue.enqueue('c', '1', null).node
  assert.equal(queue.withdraw('b').node, b, 'withdraw without a physical message hits the current demand')
  const d = queue.enqueue('d', '1', null).node
  assert.deepEqual(queue.drain(), [c, d])
  assert.equal(queue.count(), 0)
  assert.deepEqual(queue.snapshot(), [])
})
