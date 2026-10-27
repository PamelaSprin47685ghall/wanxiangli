import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FissionLaneRegistry,
  fissionLaneRegistry,
  FissionAdmissionRegistry,
  fissionAdmissionRegistry
} from 'wanxiangli/fission-group'

test('SPEC[fission-registry-1] FissionLaneRegistry class and singleton export correctly', () => {
  assert.equal(typeof FissionLaneRegistry, 'function')
  assert.equal(typeof fissionLaneRegistry, 'object')
  assert.equal(fissionLaneRegistry instanceof FissionLaneRegistry, true)
})

test('SPEC[fission-registry-2] bindLane, tryLane, tryOwner, logicalOwner work for in-memory lanes', () => {
  const reg = new FissionLaneRegistry()
  assert.equal(reg.getLaneCount(), 0)
  assert.equal(reg.tryLane('lane-1'), undefined)
  assert.equal(reg.tryOwner('lane-1'), undefined)
  assert.equal(reg.logicalOwner('lane-1'), 'lane-1')

  reg.bindLane('group-A', 'owner-X', 0, 2, 'lane-1')
  reg.bindLane('group-A', 'owner-X', 1, 2, 'lane-2')
  assert.equal(reg.getLaneCount(), 2)

  const b1 = reg.tryLane('lane-1')
  assert.deepEqual({ ...b1 }, {
    GroupId: 'group-A',
    OwnerSessionId: 'owner-X',
    LaneIndex: 0,
    LaneCount: 2,
  })
  assert.equal(reg.tryOwner('lane-1'), 'owner-X')
  assert.equal(reg.logicalOwner('lane-1'), 'owner-X')
  assert.equal(reg.logicalOwner('other-session'), 'other-session')
})

test('SPEC[fission-registry-3] unbindLane removes specific lane cleanly', () => {
  const reg = new FissionLaneRegistry()
  reg.bindLane('group-B', 'owner-Y', 0, 2, 'lane-3')
  assert.equal(reg.getLaneCount(), 1)

  assert.equal(reg.unbindLane('lane-3'), true)
  assert.equal(reg.getLaneCount(), 0)
  assert.equal(reg.tryLane('lane-3'), undefined)
  assert.equal(reg.unbindLane('lane-3'), false)
})

test('SPEC[fission-registry-4] clearOwner and clearOwnerLanes remove matching lanes and return groupIds', () => {
  const reg = new FissionLaneRegistry()
  reg.bindLane('group-1', 'owner-1', 0, 3, 'lane-1')
  reg.bindLane('group-1', 'owner-1', 1, 3, 'lane-2')
  reg.bindLane('group-2', 'owner-1', 0, 2, 'lane-3')
  reg.bindLane('group-3', 'owner-2', 0, 2, 'lane-4') // different owner
  assert.equal(reg.getLaneCount(), 4)

  const cleanup = reg.clearOwner('owner-1')
  assert.deepEqual([...cleanup.RemovedLanes].sort(), ['lane-1', 'lane-2', 'lane-3'])
  assert.deepEqual([...cleanup.RemovedGroupIds].sort(), ['group-1', 'group-2'])
  assert.equal(reg.getLaneCount(), 1)
  assert.equal(reg.tryLane('lane-4')?.OwnerSessionId, 'owner-2')

  // Calling again for cleared owner is idempotent
  const cleanupAgain = reg.clearOwner('owner-1')
  assert.deepEqual(cleanupAgain.RemovedLanes, [])
  assert.deepEqual(cleanupAgain.RemovedGroupIds, [])
})

test('SPEC[fission-registry-5] hydrateFromDurable serves fallback when memory misses, memory overrides fallback', () => {
  const reg = new FissionLaneRegistry()
  reg.hydrateFromDurable((laneId) => {
    if (laneId === 'durable-lane') {
      return {
        GroupId: 'group-durable',
        OwnerSessionId: 'owner-durable',
        LaneIndex: 1,
        LaneCount: 2,
      }
    }
    return undefined
  })

  // Durable fallback hit
  const durableHit = reg.tryLane('durable-lane')
  assert.deepEqual(durableHit, {
    GroupId: 'group-durable',
    OwnerSessionId: 'owner-durable',
    LaneIndex: 1,
    LaneCount: 2,
  })
  assert.equal(reg.logicalOwner('durable-lane'), 'owner-durable')

  // Memory override
  reg.bindLane('group-override', 'owner-override', 0, 2, 'durable-lane')
  const overrideHit = reg.tryLane('durable-lane')
  assert.equal(overrideHit.GroupId, 'group-override')
  assert.equal(overrideHit.OwnerSessionId, 'owner-override')
})

test('SPEC[fission-registry-6] singleton works and is isolated from independent instances', () => {
  fissionLaneRegistry.clearAll()
  assert.equal(fissionLaneRegistry.getLaneCount(), 0)

  fissionLaneRegistry.bindLane('g-s', 'o-s', 0, 2, 'l-s')
  assert.equal(fissionLaneRegistry.getLaneCount(), 1)

  const independent = new FissionLaneRegistry()
  assert.equal(independent.getLaneCount(), 0)

  fissionLaneRegistry.clearAll()
  assert.equal(fissionLaneRegistry.getLaneCount(), 0)
})

test('SPEC[fission-admission-1] FissionAdmissionRegistry class and singleton export correctly', () => {
  assert.equal(typeof FissionAdmissionRegistry, 'function')
  assert.equal(typeof fissionAdmissionRegistry, 'object')
  assert.equal(fissionAdmissionRegistry instanceof FissionAdmissionRegistry, true)
})

test('SPEC[fission-admission-2] first reserve succeeds, duplicate reserve returns false', () => {
  const reg = new FissionAdmissionRegistry()
  assert.equal(reg.isActive('owner-1'), false)
  assert.equal(reg.reserve('owner-1'), true)
  assert.equal(reg.isActive('owner-1'), true)

  // Duplicate reserve for same owner returns false
  assert.equal(reg.reserve('owner-1'), false)
  assert.equal(reg.isActive('owner-1'), true)
})

test('SPEC[fission-admission-3] release allows subsequent reserve, other owners unaffected', () => {
  const reg = new FissionAdmissionRegistry()
  assert.equal(reg.reserve('owner-1'), true)
  assert.equal(reg.reserve('owner-2'), true)
  assert.deepEqual(reg.snapshot(), ['owner-1', 'owner-2'])

  reg.release('owner-1')
  assert.equal(reg.isActive('owner-1'), false)
  assert.equal(reg.isActive('owner-2'), true)

  // Can reserve again after release
  assert.equal(reg.reserve('owner-1'), true)
  assert.equal(reg.isActive('owner-1'), true)

  // Idempotent redundant release does not throw or affect other owners
  assert.doesNotThrow(() => reg.release('owner-1'))
  assert.doesNotThrow(() => reg.release('non-existent-owner'))
  assert.equal(reg.isActive('owner-2'), true)
})

test('SPEC[fission-admission-4] defensive handling for blank ownerSessionId', () => {
  const reg = new FissionAdmissionRegistry()
  const invalidInputs = [null, undefined, '', '   ', '\t\n', 123, {}, []]

  for (const input of invalidInputs) {
    assert.equal(reg.reserve(input), false, `reserve should reject ${JSON.stringify(input)}`)
    assert.equal(reg.isActive(input), false, `isActive should return false for ${JSON.stringify(input)}`)
    assert.doesNotThrow(() => reg.release(input), `release should silently ignore ${JSON.stringify(input)}`)
  }

  assert.deepEqual(reg.snapshot(), [])
})

test('SPEC[fission-admission-5] snapshot returns sorted copy and prevents external mutation', () => {
  const reg = new FissionAdmissionRegistry()
  reg.reserve('owner-z')
  reg.reserve('owner-a')
  reg.reserve('owner-m')

  const snap = reg.snapshot()
  assert.deepEqual(snap, ['owner-a', 'owner-m', 'owner-z'])

  // External array mutation does not affect internal state
  snap.push('owner-tampered')
  snap[0] = 'owner-corrupted'
  assert.equal(reg.isActive('owner-tampered'), false)
  assert.equal(reg.isActive('owner-corrupted'), false)
  assert.deepEqual(reg.snapshot(), ['owner-a', 'owner-m', 'owner-z'])
})

test('SPEC[fission-admission-6] clear resets all admissions', () => {
  const reg = new FissionAdmissionRegistry()
  reg.reserve('owner-1')
  reg.reserve('owner-2')
  assert.equal(reg.snapshot().length, 2)

  reg.clear()
  assert.equal(reg.isActive('owner-1'), false)
  assert.equal(reg.isActive('owner-2'), false)
  assert.deepEqual(reg.snapshot(), [])

  // Can reserve again after clear
  assert.equal(reg.reserve('owner-1'), true)
})

test('SPEC[fission-admission-7] independent instances are isolated from each other and singleton', () => {
  fissionAdmissionRegistry.clear()
  const reg1 = new FissionAdmissionRegistry()
  const reg2 = new FissionAdmissionRegistry()

  assert.equal(reg1.reserve('isolated-owner'), true)
  assert.equal(reg1.isActive('isolated-owner'), true)
  assert.equal(reg2.isActive('isolated-owner'), false)
  assert.equal(fissionAdmissionRegistry.isActive('isolated-owner'), false)

  assert.equal(fissionAdmissionRegistry.reserve('singleton-owner'), true)
  assert.equal(reg1.isActive('singleton-owner'), false)
  assert.equal(reg2.isActive('singleton-owner'), false)
  assert.equal(fissionAdmissionRegistry.isActive('singleton-owner'), true)

  fissionAdmissionRegistry.clear()
  assert.equal(fissionAdmissionRegistry.isActive('singleton-owner'), false)
  assert.equal(reg1.isActive('isolated-owner'), true)
})
