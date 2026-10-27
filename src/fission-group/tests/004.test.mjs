import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FissionLaneRegistry,
  fissionLaneRegistry,
  FissionRuntime,
  fissionRuntime
} from 'wanxiangli/fission-group'

test('SPEC[fission-runtime-1] FissionRuntime class and singleton export correctly', () => {
  assert.equal(typeof FissionRuntime, 'function')
  assert.equal(typeof fissionRuntime, 'object')
  assert.equal(fissionRuntime instanceof FissionRuntime, true)
  assert.equal(fissionRuntime.LaneRegistry instanceof FissionLaneRegistry, true)
})

test('SPEC[fission-runtime-2] silentInterrupt lifecycle: mark, check, tryConsume without removal, clear, and clearOwner', () => {
  const runtime = new FissionRuntime(new FissionLaneRegistry())
  const ownerA = 'owner-session-a'
  const ownerB = 'owner-session-b'

  // Initial: no silent interrupt
  assert.equal(runtime.isSilentInterrupt(ownerA), false)
  assert.equal(runtime.tryConsumeSilentInterrupt(ownerA), false)

  // Mark ownerA
  runtime.markSilentInterrupt(ownerA)
  assert.equal(runtime.isSilentInterrupt(ownerA), true)

  // tryConsumeSilentInterrupt is read-only (Contains): MUST NOT remove the mark
  assert.equal(runtime.tryConsumeSilentInterrupt(ownerA), true)
  assert.equal(runtime.isSilentInterrupt(ownerA), true)
  assert.equal(runtime.tryConsumeSilentInterrupt(ownerA), true)

  // Clear ownerA explicitly
  runtime.clearSilentInterrupt(ownerA)
  assert.equal(runtime.isSilentInterrupt(ownerA), false)

  // Mark both ownerA and ownerB
  runtime.markSilentInterrupt(ownerA)
  runtime.markSilentInterrupt(ownerB)
  assert.equal(runtime.isSilentInterrupt(ownerA), true)
  assert.equal(runtime.isSilentInterrupt(ownerB), true)

  // clearOwner(ownerA) clears ownerA but leaves ownerB untouched
  runtime.clearOwner(ownerA)
  assert.equal(runtime.isSilentInterrupt(ownerA), false)
  assert.equal(runtime.isSilentInterrupt(ownerB), true)

  // Empty string defense
  assert.equal(runtime.isSilentInterrupt(''), false)
  assert.equal(runtime.tryConsumeSilentInterrupt(''), false)
  runtime.clearSilentInterrupt('')
  runtime.markSilentInterrupt('')
  assert.equal(runtime.isSilentInterrupt(''), false)
})

test('SPEC[fission-runtime-3] deliveryClaims: single-flight exclusion, key isolation, preservation on clearOwner, and late endDelivery', () => {
  const runtime = new FissionRuntime(new FissionLaneRegistry())
  const groupId = 'group-delivery-1'
  const compA = 'completion-agent-1'
  const compB = 'completion-agent-2'

  // First claim succeeds
  assert.equal(runtime.tryBeginDelivery(groupId, compA, 0), true)
  assert.equal(runtime.hasDeliveryClaim(groupId, compA, 0), true)

  // Concurrent duplicate claim for exact same (group, completion, lane) fails
  assert.equal(runtime.tryBeginDelivery(groupId, compA, 0), false)

  // Distinct lane indices do not conflict
  assert.equal(runtime.tryBeginDelivery(groupId, compA, 1), true)
  assert.equal(runtime.hasDeliveryClaim(groupId, compA, 1), true)

  // Broadcast (-1) does not conflict with lane 0 or 1
  assert.equal(runtime.tryBeginDelivery(groupId, compA, -1), true)
  assert.equal(runtime.hasDeliveryClaim(groupId, compA, -1), true)

  // Distinct completion IDs do not conflict
  assert.equal(runtime.tryBeginDelivery(groupId, compB, 0), true)

  // Distinct groups do not conflict
  assert.equal(runtime.tryBeginDelivery('group-delivery-2', compA, 0), true)

  // INVARIANT: clearOwner MUST NOT wipe in-flight deliveryClaims (preserves single-flight protection for running delivery tasks)
  const owner = 'owner-delivery'
  runtime.bindLane(groupId, owner, 0, 2, 'lane-del-0')
  runtime.clearOwner(owner)
  assert.equal(runtime.hasDeliveryClaim(groupId, compA, 0), true)
  assert.equal(runtime.hasDeliveryClaim(groupId, compA, 1), true)

  // In-flight delivery task finally completes: endDelivery releases claim
  runtime.endDelivery(groupId, compA, 0)
  assert.equal(runtime.hasDeliveryClaim(groupId, compA, 0), false)

  // Now a subsequent delivery for (groupId, compA, 0) can be admitted
  assert.equal(runtime.tryBeginDelivery(groupId, compA, 0), true)
  runtime.endDelivery(groupId, compA, 0)

  // Late or redundant endDelivery does not throw or corrupt other claims
  runtime.endDelivery(groupId, compA, 0)
  assert.doesNotThrow(() => runtime.endDelivery('non-existent-group', 'no-comp', 99))
  assert.equal(runtime.hasDeliveryClaim(groupId, compA, 1), true)
})

test('SPEC[fission-runtime-4] takeoverClaims: single-flight mutual exclusion, clearOwner cleanup, and late endTakeover', () => {
  const runtime = new FissionRuntime(new FissionLaneRegistry())
  const groupA = 'group-takeover-a'
  const groupB = 'group-takeover-b'
  const ownerA = 'owner-takeover-a'
  const ownerB = 'owner-takeover-b'

  runtime.bindLane(groupA, ownerA, 0, 2, 'lane-to-0')
  runtime.bindLane(groupB, ownerB, 0, 2, 'lane-to-1')

  // Acquire takeover for groupA
  assert.equal(runtime.tryBeginTakeover(groupA), true)
  assert.equal(runtime.hasTakeoverClaim(groupA), true)

  // Concurrent takeover claim on groupA fails
  assert.equal(runtime.tryBeginTakeover(groupA), false)

  // Distinct groupB succeeds independently
  assert.equal(runtime.tryBeginTakeover(groupB), true)
  assert.equal(runtime.hasTakeoverClaim(groupB), true)

  // Normal release on groupB
  runtime.endTakeover(groupB)
  assert.equal(runtime.hasTakeoverClaim(groupB), false)
  assert.equal(runtime.tryBeginTakeover(groupB), true)

  // clearOwner(ownerA) clears takeover claims for groupA and closes groupA
  runtime.clearOwner(ownerA)
  assert.equal(runtime.hasTakeoverClaim(groupA), false)
  // groupB belonging to ownerB is untouched
  assert.equal(runtime.hasTakeoverClaim(groupB), true)

  // TERMINAL GATE INVARIANT: clearOwner marks groupA as closed/terminated.
  // A terminated group MUST REJECT any subsequent tryBeginTakeover!
  assert.equal(runtime.isGroupClosed(groupA), true)
  assert.equal(runtime.tryBeginTakeover(groupA), false)

  // Late endTakeover on groupA after clearOwner does not throw, does not reopen groupA
  assert.doesNotThrow(() => runtime.endTakeover(groupA))
  assert.equal(runtime.hasTakeoverClaim(groupA), false)
  assert.equal(runtime.tryBeginTakeover(groupA), false)

  // Distinct active groupC verifies normal subsequent tryBeginTakeover succeeds after explicit release,
  // and late endTakeover on terminated groupA does not corrupt or release groupC's claim
  const groupC = 'group-takeover-c'
  assert.equal(runtime.tryBeginTakeover(groupC), true)
  assert.equal(runtime.hasTakeoverClaim(groupC), true)
  runtime.endTakeover(groupA) // redundant late call on closed group
  assert.equal(runtime.hasTakeoverClaim(groupC), true)
  runtime.endTakeover(groupC)
  assert.equal(runtime.hasTakeoverClaim(groupC), false)
  assert.equal(runtime.tryBeginTakeover(groupC), true)
})

test('SPEC[fission-runtime-5] groupResources: disposal with .Dispose() and .dispose(), error resilience, and reentrancy', () => {
  const runtime = new FissionRuntime(new FissionLaneRegistry())
  const groupId = 'group-res-1'

  let disposedUpper = false
  let disposedLower = false
  let disposedAfterError = false

  // Resource with .Dispose() (.NET / Fable style)
  const res1 = {
    Dispose() {
      disposedUpper = true
    }
  }

  // Resource that throws on .Dispose()
  const resThrow = {
    Dispose() {
      throw new Error('disposal failure in resource')
    }
  }

  // Resource with .dispose() (JS / TS style)
  const res2 = {
    dispose() {
      disposedLower = true
    }
  }

  // Resource tracked after throwing one
  const res3 = {
    Dispose() {
      disposedAfterError = true
    }
  }

  runtime.trackGroupResource(groupId, res1)
  runtime.trackGroupResource(groupId, resThrow)
  runtime.trackGroupResource(groupId, res2)
  runtime.trackGroupResource(groupId, res3)

  // disposeGroupResources executes without throwing, and disposes all resources despite resThrow error
  assert.doesNotThrow(() => runtime.disposeGroupResources(groupId))
  assert.equal(disposedUpper, true)
  assert.equal(disposedLower, true)
  assert.equal(disposedAfterError, true)

  // Repeated call is safe and idempotent (resources already drained)
  assert.doesNotThrow(() => runtime.disposeGroupResources(groupId))

  // Reentrancy and late registration test:
  // When a group is closed/disposed, closedGroups gate prevents loop spinning and leaks:
  // Any resource tracked during or after disposal is immediately disposed on the spot.
  const groupReentrant = 'group-res-reentrant'
  let reentrantResourceDisposed = false
  const reentrantRes = {
    Dispose() {
      runtime.trackGroupResource(groupReentrant, {
        Dispose() {
          reentrantResourceDisposed = true
        }
      })
    }
  }
  runtime.trackGroupResource(groupReentrant, reentrantRes)
  assert.doesNotThrow(() => runtime.disposeGroupResources(groupReentrant))
  assert.equal(reentrantResourceDisposed, true)

  // Late registration after group is closed: immediately disposed, not leaked into dictionary
  let lateResourceDisposed = false
  runtime.trackGroupResource(groupReentrant, {
    Dispose() {
      lateResourceDisposed = true
    }
  })
  assert.equal(lateResourceDisposed, true)
})

test('SPEC[fission-runtime-6] coordinated clearOwner: atomic multi-facet cleanup with in-flight delivery claim preservation', () => {
  const runtime = new FissionRuntime(new FissionLaneRegistry())
  const owner = 'owner-full-flow'
  const groupId = 'group-full-flow'
  const lane0 = 'lane-full-0'
  const lane1 = 'lane-full-1'

  // 1. Bind lanes
  runtime.bindLane(groupId, owner, 0, 2, lane0)
  runtime.bindLane(groupId, owner, 1, 2, lane1)
  assert.equal(runtime.tryOwner(lane0), owner)
  assert.equal(runtime.tryOwner(lane1), owner)

  // 2. Mark silent interrupt
  runtime.markSilentInterrupt(owner)
  assert.equal(runtime.isSilentInterrupt(owner), true)

  // 3. Acquire takeover claim
  assert.equal(runtime.tryBeginTakeover(groupId), true)

  // 4. Acquire in-flight delivery claim
  assert.equal(runtime.tryBeginDelivery(groupId, 'comp-X', 0), true)

  // 5. Track disposable group resources
  let resADisposed = false
  let resBDisposed = false
  runtime.trackGroupResource(groupId, { Dispose() { resADisposed = true } })
  runtime.trackGroupResource(groupId, { dispose() { resBDisposed = true } })

  // 6. Execute clearOwner
  const result = runtime.clearOwner(owner)
  assert.deepEqual([...result.RemovedLanes].sort(), [lane0, lane1].sort())
  assert.deepEqual(result.RemovedGroupIds, [groupId])

  // Verifications after clearOwner:
  // A. Lane bindings are removed
  assert.equal(runtime.tryLane(lane0), undefined)
  assert.equal(runtime.tryOwner(lane0), undefined)

  // B. Silent interrupt is cleared
  assert.equal(runtime.isSilentInterrupt(owner), false)

  // C. Takeover claim is cleared
  assert.equal(runtime.hasTakeoverClaim(groupId), false)

  // D. Group resources are disposed
  assert.equal(resADisposed, true)
  assert.equal(resBDisposed, true)

  // E. Delivery claim is PRESERVED (uninterrupted for in-flight execution)
  assert.equal(runtime.hasDeliveryClaim(groupId, 'comp-X', 0), true)

  // F. Later in-flight delivery task finishes safely
  runtime.endDelivery(groupId, 'comp-X', 0)
  assert.equal(runtime.hasDeliveryClaim(groupId, 'comp-X', 0), false)
})

test('SPEC[fission-runtime-7] instance isolation between independent FissionRuntime instances', () => {
  const runtimeA = new FissionRuntime(new FissionLaneRegistry())
  const runtimeB = new FissionRuntime(new FissionLaneRegistry())

  runtimeA.markSilentInterrupt('owner-x')
  runtimeA.tryBeginTakeover('group-x')
  runtimeA.tryBeginDelivery('group-x', 'comp', 0)

  assert.equal(runtimeA.isSilentInterrupt('owner-x'), true)
  assert.equal(runtimeB.isSilentInterrupt('owner-x'), false)

  assert.equal(runtimeA.hasTakeoverClaim('group-x'), true)
  assert.equal(runtimeB.hasTakeoverClaim('group-x'), false)

  assert.equal(runtimeA.hasDeliveryClaim('group-x', 'comp', 0), true)
  assert.equal(runtimeB.hasDeliveryClaim('group-x', 'comp', 0), false)
})
