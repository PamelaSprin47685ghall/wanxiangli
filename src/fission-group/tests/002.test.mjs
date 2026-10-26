import test from 'node:test'
import assert from 'node:assert/strict'

import { FissionLaneQuiescenceGate, fissionLaneQuiescenceGate } from 'wanxiangli/fission-group'

test('SPEC[fission-gate-1] FissionLaneQuiescenceGate class and singleton export correctly', () => {
  assert.equal(typeof FissionLaneQuiescenceGate, 'function')
  assert.equal(typeof fissionLaneQuiescenceGate, 'object')
  assert.equal(fissionLaneQuiescenceGate instanceof FissionLaneQuiescenceGate, true)
})

test('SPEC[fission-gate-2] lane enters quiescence idempotently and tracks counts', () => {
  const gate = new FissionLaneQuiescenceGate()
  assert.equal(gate.getLaneCount('g1'), 0)
  assert.equal(gate.isLaneQuiescent('g1', 'l1'), false)
  assert.equal(gate.isGroupQuiescent('g1'), false)

  // First enter returns true (state changed)
  assert.equal(gate.enterQuiescent('g1', 'l1'), true)
  assert.equal(gate.isLaneQuiescent('g1', 'l1'), true)
  assert.equal(gate.getLaneCount('g1'), 1)

  // Single lane is never group quiescent
  assert.equal(gate.isGroupQuiescent('g1'), false)

  // Duplicate enter is idempotent (returns false)
  assert.equal(gate.enterQuiescent('g1', 'l1'), false)
  assert.equal(gate.getLaneCount('g1'), 1)

  // Add second lane
  assert.equal(gate.enterQuiescent('g1', 'l2'), true)
  assert.equal(gate.getLaneCount('g1'), 2)
  assert.deepEqual([...gate.getQuiescentLanes('g1')].sort(), ['l1', 'l2'])

  // Both quiescent => group quiescent
  assert.equal(gate.isGroupQuiescent('g1'), true)
  assert.equal(gate.isGroupQuiescent('g1', 2), true)
  assert.equal(gate.isGroupQuiescent('g1', 3), false) // expected 3, but only 2
})

test('SPEC[fission-gate-3] leaveQuiescent / markActive breaks group quiescence', () => {
  const gate = new FissionLaneQuiescenceGate()
  gate.enterQuiescent('g2', 'l1')
  gate.enterQuiescent('g2', 'l2')
  assert.equal(gate.isGroupQuiescent('g2'), true)

  // Leave quiescent
  assert.equal(gate.leaveQuiescent('g2', 'l1'), true)
  assert.equal(gate.isLaneQuiescent('g2', 'l1'), false)
  assert.equal(gate.isLaneQuiescent('g2', 'l2'), true)
  assert.equal(gate.isGroupQuiescent('g2'), false)

  // Duplicate leave returns false
  assert.equal(gate.leaveQuiescent('g2', 'l1'), false)

  // Re-enter restores group quiescence
  assert.equal(gate.markQuiescent('g2', 'l1'), true)
  assert.equal(gate.isGroupQuiescent('g2'), true)
})

test('SPEC[fission-gate-4] clearLane and clearGroup reset state cleanly', () => {
  const gate = new FissionLaneQuiescenceGate()
  gate.enterQuiescent('g3', 'l1')
  gate.enterQuiescent('g3', 'l2')

  assert.equal(gate.clearLane('g3', 'l1'), true)
  assert.equal(gate.isLaneQuiescent('g3', 'l1'), false)
  assert.equal(gate.getLaneCount('g3'), 1)
  assert.equal(gate.isGroupQuiescent('g3'), false)

  assert.equal(gate.clearGroup('g3'), true)
  assert.equal(gate.getLaneCount('g3'), 0)
  assert.equal(gate.clearGroup('g3'), false)
})

test('SPEC[fission-gate-5] singleton instance works and is isolated from new instances', () => {
  fissionLaneQuiescenceGate.clearAll()
  assert.equal(fissionLaneQuiescenceGate.getLaneCount('g-singleton'), 0)

  fissionLaneQuiescenceGate.enterQuiescent('g-singleton', 'lane-a')
  fissionLaneQuiescenceGate.enterQuiescent('g-singleton', 'lane-b')
  assert.equal(fissionLaneQuiescenceGate.isGroupQuiescent('g-singleton'), true)

  const independent = new FissionLaneQuiescenceGate()
  assert.equal(independent.getLaneCount('g-singleton'), 0)

  fissionLaneQuiescenceGate.clearAll()
})
