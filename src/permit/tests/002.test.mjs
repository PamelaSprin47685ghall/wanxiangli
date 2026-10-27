import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ExecutionPermits,
  CapacityTransitionCounters,
  capacityTransitionCounters,
  SessionLeaseHandles,
  sessionLeaseHandles,
} from 'wanxiangli/permit'

test('SPEC[permit-5] CapacityTransitionCounters records outcomes and increments corresponding counters', () => {
  const counters = new CapacityTransitionCounters()
  assert.deepEqual(counters.snapshot(), { duplicate: 0, stale: 0, conflict: 0 })

  assert.equal(counters.record('Applied'), 'Applied')
  assert.deepEqual(counters.snapshot(), { duplicate: 0, stale: 0, conflict: 0 })

  assert.equal(counters.record('AlreadyApplied'), 'AlreadyApplied')
  assert.deepEqual(counters.snapshot(), { duplicate: 1, stale: 0, conflict: 0 })

  assert.equal(counters.record('StaleFence'), 'StaleFence')
  assert.deepEqual(counters.snapshot(), { duplicate: 1, stale: 1, conflict: 0 })

  assert.equal(counters.record('Conflict'), 'Conflict')
  assert.deepEqual(counters.snapshot(), { duplicate: 1, stale: 1, conflict: 1 })

  assert.equal(counters.record('AlreadyApplied'), 'AlreadyApplied')
  assert.deepEqual(counters.snapshot(), { duplicate: 2, stale: 1, conflict: 1 })

  assert.ok(Object.isFrozen(counters.snapshot()))
})

test('SPEC[permit-5] CapacityTransitionCounters direct increments, reset and isolation', () => {
  const c1 = new CapacityTransitionCounters()
  const c2 = new CapacityTransitionCounters()

  assert.equal(c1.recordDuplicate(), 1)
  assert.equal(c1.recordStale(), 1)
  assert.equal(c1.recordConflict(), 1)
  assert.deepEqual(c1.snapshot(), { duplicate: 1, stale: 1, conflict: 1 })
  assert.deepEqual(c2.snapshot(), { duplicate: 0, stale: 0, conflict: 0 }, 'c2 remains zero')

  c1.reset()
  assert.deepEqual(c1.snapshot(), { duplicate: 0, stale: 0, conflict: 0 })

  // Singleton exists and behaves independently
  assert.ok(capacityTransitionCounters instanceof CapacityTransitionCounters)
})

test('SPEC[permit-6] SessionLeaseHandles reuses handle for same session and identical permit', () => {
  const handles = new SessionLeaseHandles()
  const fakePermit1 = Object.freeze({ leaseId: 1, fence: 1, credit: 1 })
  let createdCount = 0

  const create = (lid, f) => {
    createdCount++
    return { handleId: 'h-1', lid, f, owner: fakePermit1 }
  }

  const h1 = handles.handleFor('ses-a', fakePermit1, create)
  assert.equal(createdCount, 1)
  assert.deepEqual(h1, { handleId: 'h-1', lid: 1, f: 1, owner: fakePermit1 })
  assert.equal(handles.nextLeaseId, 1)
  assert.equal(handles.nextFence, 1)
  assert.equal(handles.has('ses-a'), true)
  assert.equal(handles.current('ses-a'), h1)

  // Repeated call with same permit returns identical handle without invoking createHandle
  const h1Again = handles.handleFor('ses-a', fakePermit1, () => {
    assert.fail('createHandle should not be called on matching cached permit')
  })
  assert.equal(h1Again, h1)
  assert.equal(createdCount, 1)
  assert.equal(handles.nextLeaseId, 1)
  assert.equal(handles.nextFence, 1)
})

test('SPEC[permit-6] SessionLeaseHandles monotonic increments and fence divergence failure', () => {
  const handles = new SessionLeaseHandles()
  const permit1 = Object.freeze({ leaseId: 1, fence: 1 })
  const permit2 = Object.freeze({ leaseId: 2, fence: 2 })

  const h1 = handles.handleFor('ses-a', permit1, (lid, f) => ({ id: 1, lid, f }))
  assert.equal(h1.lid, 1)
  assert.equal(h1.f, 1)

  const h2 = handles.handleFor('ses-a', permit2, (lid, f) => ({ id: 2, lid, f }))
  assert.equal(h2.lid, 2)
  assert.equal(h2.f, 2)
  assert.notEqual(h1, h2)
  assert.equal(handles.current('ses-a'), h2)

  // Fence divergence: permit fence does not match nextFence (expected 3, but permit has fence 999)
  const divergedPermit = Object.freeze({ leaseId: 3, fence: 999 })
  assert.throws(
    () => handles.handleFor('ses-a', divergedPermit, (lid, f) => ({ lid, f })),
    /execution-model-routing: host lease fence diverged from the exact permit owner/
  )
})

test('SPEC[permit-6] SessionLeaseHandles tryGetMatching, snapshot, clear and isolation', () => {
  const handles = new SessionLeaseHandles()
  const pA = Object.freeze({ fence: 1 })
  const pB = Object.freeze({ fence: 2 })

  const hA = handles.handleFor('ses-1', pA, (lid, f) => ({ name: 'A', lid, f }))
  assert.equal(handles.tryGetMatching('ses-1', pA), hA)
  assert.equal(handles.tryGetMatching('ses-1', pB), null, 'permit mismatch returns null')
  assert.equal(handles.tryGetMatching('ses-2', pA), null, 'session not found returns null')
  assert.equal(handles.tryGetMatching(null, pA), null)
  assert.equal(handles.tryGetMatching('ses-1', null), null)

  const snap = handles.snapshot()
  assert.deepEqual(snap, { activeCount: 1, nextLeaseId: 1, nextFence: 1 })
  assert.ok(Object.isFrozen(snap))

  handles.clear()
  assert.equal(handles.has('ses-1'), false)
  assert.equal(handles.current('ses-1'), null)
  assert.equal(handles.tryGetMatching('ses-1', pA), null)
  assert.equal(handles.snapshot().activeCount, 0)

  // Singleton check
  assert.ok(sessionLeaseHandles instanceof SessionLeaseHandles)
})
