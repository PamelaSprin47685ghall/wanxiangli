import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SettledRunLedger,
  settledRunLedger,
  AdvisorSeatRegistry,
  advisorSeatRegistry,
  AdvisorRegistryLaw
} from 'wanxiangli/advisor'

// Helper to construct F# Result
const Ok = (val) => ({ tag: 0, fields: [val] })
const Error = (err) => ({ tag: 1, fields: [err] })

test('SPEC[advisor-seat-1] single-flight creation does not invoke startChild concurrently more than once', async () => {
  const registry = new AdvisorSeatRegistry()
  let factoryCalls = 0

  const slowStartChild = () =>
    new Promise((resolve) => {
      factoryCalls++
      setTimeout(() => resolve(Ok('advisor-child-100')), 20)
    })

  // Three concurrent consults for the same caller session
  const [res1, res2, res3] = await Promise.all([
    registry.ensureSeatChild('caller-A', slowStartChild),
    registry.ensureSeatChild('caller-A', slowStartChild),
    registry.ensureSeatChild('caller-A', slowStartChild)
  ])

  assert.equal(factoryCalls, 1, 'startChild factory must be invoked exactly once')
  assert.equal(res1.tag, 0)
  assert.equal(res1.fields[0], 'advisor-child-100')
  assert.equal(res2.fields[0], 'advisor-child-100')
  assert.equal(res3.fields[0], 'advisor-child-100')

  // Independent caller invokes its own factory
  const otherRes = await registry.ensureSeatChild('caller-B', () => { factoryCalls++; return Promise.resolve(Ok('advisor-child-200')) })
  assert.equal(otherRes.fields[0], 'advisor-child-200')
  assert.equal(factoryCalls, 2)
})

test('SPEC[advisor-seat-2] failed child creation latches failure without permanent poison and allows next consult retry', async () => {
  const registry = new AdvisorSeatRegistry()
  let attempts = 0

  const failingFactory = () => {
    attempts++
    if (attempts === 1) {
      return Promise.resolve(Error('network timeout on creation'))
    }
    return Promise.resolve(Ok('advisor-child-recovered'))
  }

  // First consult fails
  const first = await registry.ensureSeatChild('caller-C', failingFactory)
  assert.equal(first.tag, 1)
  assert.match(first.fields[0], /network timeout/)
  assert.equal(registry.hasCreateFailed('caller-C'), true)

  // Next consult resets the failure latch and retries successfully
  const second = await registry.ensureSeatChild('caller-C', failingFactory)
  assert.equal(second.tag, 0)
  assert.equal(second.fields[0], 'advisor-child-recovered')
  assert.equal(registry.hasCreateFailed('caller-C'), false)
  assert.equal(attempts, 2)
})

test('SPEC[advisor-seat-3] successful child creation is memoized across subsequent consults', async () => {
  const registry = new AdvisorSeatRegistry()
  let calls = 0

  const factory = () => {
    calls++
    return Promise.resolve(Ok('child-stable'))
  }

  const first = await registry.ensureSeatChild('caller-D', factory)
  assert.equal(first.fields[0], 'child-stable')
  assert.equal(calls, 1)

  const second = await registry.ensureSeatChild('caller-D', factory)
  assert.equal(second.fields[0], 'child-stable')
  assert.equal(calls, 1, 'subsequent consult must reuse memoized child session without calling factory')
})

test('SPEC[advisor-seat-4] clear and clearAll are strictly idempotent', async () => {
  const registry = new AdvisorSeatRegistry()
  await registry.ensureSeatChild('caller-E', () => Promise.resolve(Ok('child-E')))
  assert.equal(registry.isSeatKnown('caller-E'), true)

  // First clear removes seat and returns child ID
  const removed = registry.clear('caller-E')
  assert.equal(removed, 'child-E')
  assert.equal(registry.isSeatKnown('caller-E'), false)

  // Duplicate clear is idempotent (returns undefined, no throw)
  assert.equal(registry.clear('caller-E'), undefined)
  assert.equal(registry.clear('non-existent'), undefined)

  // Re-creating after clear invokes factory freshly
  let calledAgain = false
  await registry.ensureSeatChild('caller-E', () => {
    calledAgain = true
    return Promise.resolve(Ok('child-E-new'))
  })
  assert.equal(calledAgain, true)

  // clearAll drops all
  registry.clearAll()
  assert.equal(registry.isSeatKnown('caller-E'), false)
  assert.doesNotThrow(() => registry.clearAll())
})

test('SPEC[advisor-seat-5] clear returns bound childSessionId to bridge retirement without key mismatch', async () => {
  const registry = new AdvisorSeatRegistry()
  assert.equal(registry.clear('caller-X'), undefined)

  await registry.ensureSeatChild('caller-X', () => Promise.resolve(Ok('child-X-uuid')))
  assert.equal(registry.tryChildId('caller-X'), 'child-X-uuid')

  const removedChildId = registry.clear('caller-X')
  assert.equal(removedChildId, 'child-X-uuid')
  assert.equal(registry.isSeatKnown('caller-X'), false)
})

test('SPEC[advisor-run-1] SettledRunLedger prevents cross-generation mis-settlement and identifies stale runs', () => {
  const ledger = new SettledRunLedger()

  assert.equal(ledger.hasSettledRun('child-1'), false)
  assert.equal(ledger.priorRun('child-1'), '')
  assert.equal(ledger.isStale('child-1', 'run-100'), false)

  // First consult settles on run-100
  ledger.recordSettled('child-1', 'run-100')
  assert.equal(ledger.hasSettledRun('child-1'), true)
  assert.equal(ledger.priorRun('child-1'), 'run-100')
  assert.equal(ledger.tryPriorRun('child-1'), 'run-100')

  // Prior settled run is stale! Replays or delayed terminals of run-100 must be rejected
  assert.equal(ledger.isStale('child-1', 'run-100'), true, 'old run must be identified as stale')
  assert.equal(ledger.isStale('child-1', 'run-101'), false, 'fresh run must not be stale')

  // Next consult advances and settles on run-101
  ledger.recordSettled('child-1', 'run-101')
  assert.equal(ledger.priorRun('child-1'), 'run-101')
  assert.equal(ledger.isStale('child-1', 'run-100'), true, 'run-100 remains stale in history')
  assert.equal(ledger.isStale('child-1', 'run-101'), true, 'run-101 is now stale')
})

test('SPEC[advisor-run-2] SettledRunLedger session isolation and idempotent cleanup', () => {
  const ledger = new SettledRunLedger()

  ledger.recordSettled('child-A', 'run-A1')
  ledger.recordSettled('child-B', 'run-B1')

  assert.equal(ledger.priorRun('child-A'), 'run-A1')
  assert.equal(ledger.priorRun('child-B'), 'run-B1')

  // Clear child-A retires child-A
  ledger.clearSession('child-A')
  assert.equal(ledger.isRetired('child-A'), true)
  assert.equal(ledger.isRetired('child-B'), false)

  // Duplicate clear is idempotent
  assert.doesNotThrow(() => ledger.clearSession('child-A'))
  assert.doesNotThrow(() => ledger.clearSession('child-unknown'))

  // clearAll drops all
  ledger.clearAll()
  assert.equal(ledger.hasSettledRun('child-B'), false)
  assert.doesNotThrow(() => ledger.clearAll())
})

test('SPEC[advisor-run-3] recordSettled -> retire/clearSession -> late Completed from old run is rejected and cannot settle new binding', () => {
  const ledger = new SettledRunLedger()

  // 1. First consult settles on run-100
  ledger.recordSettled('child-1', 'run-100')
  assert.equal(ledger.priorRun('child-1'), 'run-100')
  assert.equal(ledger.isRetired('child-1'), false)

  // 2. Caller session is deleted / seat is cleared: retire child-1
  ledger.retire('child-1')
  assert.equal(ledger.isRetired('child-1'), true)

  // 3. Tombstone is preserved: old run-100 arrives late as Completed
  assert.equal(ledger.isStale('child-1', 'run-100'), true, 'late Completed from old run must be rejected as stale even after retire')
  assert.equal(ledger.priorRun('child-1'), 'run-100', 'priorRun remains available as tombstone')

  // 4. New binding established on the same adopted child: fresh run-101 starts
  assert.equal(ledger.isStale('child-1', 'run-101'), false, 'fresh run-101 must not be marked stale')

  // 5. Fresh run-101 settles on the new binding
  ledger.recordSettled('child-1', 'run-101')
  assert.equal(ledger.isRetired('child-1'), false, 'settling fresh run clears retired state')
  assert.equal(ledger.priorRun('child-1'), 'run-101')

  // 6. Old run-100 is STILL stale; run-101 is now stale; run-102 is fresh
  assert.equal(ledger.isStale('child-1', 'run-100'), true, 'old run-100 remains permanently stale in history')
  assert.equal(ledger.isStale('child-1', 'run-101'), true, 'run-101 is now stale')
  assert.equal(ledger.isStale('child-1', 'run-102'), false, 'future run-102 is fresh')
})

test('SPEC[advisor-singletons] exported global singletons are available and functional', () => {
  assert.ok(advisorSeatRegistry instanceof AdvisorSeatRegistry)
  assert.ok(settledRunLedger instanceof SettledRunLedger)
  assert.doesNotThrow(() => advisorSeatRegistry.clearAll())
  assert.doesNotThrow(() => settledRunLedger.clearAll())
})

test('SPEC[advisor-law] AdvisorRegistryLaw exports contract constants', () => {
  assert.ok(AdvisorRegistryLaw !== undefined, 'AdvisorRegistryLaw must be exported')
  assert.equal(AdvisorRegistryLaw.ContractVersion, 1)
  assert.equal(AdvisorRegistryLaw.DefaultTimeoutMs, 120_000)
})
