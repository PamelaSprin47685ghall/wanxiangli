import test from 'node:test'
import assert from 'node:assert/strict'

import { FissionLaneRegistry, fissionLaneRegistry } from 'wanxiangli/fission-group'

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
