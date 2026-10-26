import test from 'node:test'
import assert from 'node:assert/strict'
import {
  Degeneration,
  envelope,
  ReliabilityDiagnosticsStore,
  reliabilityDiagnosticsStore,
  createReliabilityDiagnosticsStore,
  ReliabilityCounters,
  reliabilityCounters,
  createReliabilityCounters,
} from './support.mjs'

test('SPEC[degeneration-002] a bad token anywhere in a push leaves the statistics untouched', () => {
  const detector = Degeneration(envelope()).detector()
  detector.push([1, 2, 3])
  const before = detector.evaluate()
  for (const bad of [[4, 100], [4, -1], [4, 1.5], [4, '5'], [4, null]]) {
    assert.throws(() => detector.push(bad), /token/)
    assert.deepEqual(detector.evaluate(), before)
    assert.equal(detector.trackedTokenCount(), 3)
  }
  assert.throws(() => detector.push('1 2 3'), /tokens must be an array/)
})

test('SPEC[degeneration-002] state is bounded by the vocabulary, not by output length', () => {
  const detector = Degeneration(envelope({ vocabularySize: 5 })).detector()
  for (let round = 0; round < 2000; round += 1) detector.push([round % 5, (round * 3) % 5])
  assert.equal(detector.trackedTokenCount(), 5)
  assert.equal(detector.evaluate().step, 4000)
})

test('SPEC[reliability-counters-001] initial snapshot contains all 0n counters', () => {
  const store = new ReliabilityDiagnosticsStore()
  assert.deepEqual(store.Snapshot(), {
    identityConflicts: 0n,
    queueFull: 0n,
    fatalSettlements: 0n,
    recoveryObserveOnly: 0n,
    recoveryResumeAdmission: 0n,
    recoveryReconcileStartedProvider: 0n,
    recoveryMarkTerminal: 0n,
    recoveryFailClosed: 0n,
    recoveryManualIntervention: 0n,
    hookFailures: 0n,
    fallbackAdvances: 0n,
    streamAborts: 0n,
  })
})

test('SPEC[reliability-counters-002] all 12 observation kinds monotonically increment their respective counters', () => {
  const store = createReliabilityDiagnosticsStore()
  const kinds = [
    'identityConflict',
    'queueFull',
    'fatalSettlement',
    'recovery:observeOnly',
    'recovery:resumeAdmission',
    'recovery:reconcileStartedProvider',
    'recovery:markTerminal',
    'recovery:failClosed',
    'recovery:manualIntervention',
    'hookFailure',
    'fallbackAdvanced',
    'streamAbort',
  ]
  for (const kind of kinds) {
    store.Record(kind)
  }
  assert.deepEqual(store.Snapshot(), {
    identityConflicts: 1n,
    queueFull: 1n,
    fatalSettlements: 1n,
    recoveryObserveOnly: 1n,
    recoveryResumeAdmission: 1n,
    recoveryReconcileStartedProvider: 1n,
    recoveryMarkTerminal: 1n,
    recoveryFailClosed: 1n,
    recoveryManualIntervention: 1n,
    hookFailures: 1n,
    fallbackAdvances: 1n,
    streamAborts: 1n,
  })
})

test('SPEC[reliability-counters-003] snapshot is frozen and subsequent records do not mutate prior snapshot', () => {
  const store = new ReliabilityCounters()
  store.Record('identityConflict')
  const snap1 = store.Snapshot()
  assert.equal(Object.isFrozen(snap1), true)
  assert.equal(snap1.identityConflicts, 1n)

  store.Record('identityConflict')
  store.Record('streamAbort')
  const snap2 = store.Snapshot()

  assert.equal(snap1.identityConflicts, 1n)
  assert.equal(snap1.streamAborts, 0n)
  assert.equal(snap2.identityConflicts, 2n)
  assert.equal(snap2.streamAborts, 1n)
})

test('SPEC[reliability-counters-004] separate instances maintain isolated counters', () => {
  const storeA = new ReliabilityDiagnosticsStore()
  const storeB = createReliabilityCounters()

  storeA.Record('hookFailure')
  assert.equal(storeA.Snapshot().hookFailures, 1n)
  assert.equal(storeB.Snapshot().hookFailures, 0n)

  storeB.Record('queueFull')
  assert.equal(storeA.Snapshot().queueFull, 0n)
  assert.equal(storeB.Snapshot().queueFull, 1n)
})

test('SPEC[reliability-counters-005] Reset zeroes all 12 counters', () => {
  const store = new ReliabilityDiagnosticsStore()
  store.Record('fatalSettlement')
  store.Record('recovery:failClosed')
  assert.equal(store.Snapshot().fatalSettlements, 1n)
  assert.equal(store.Snapshot().recoveryFailClosed, 1n)

  store.Reset()
  assert.deepEqual(store.Snapshot(), {
    identityConflicts: 0n,
    queueFull: 0n,
    fatalSettlements: 0n,
    recoveryObserveOnly: 0n,
    recoveryResumeAdmission: 0n,
    recoveryReconcileStartedProvider: 0n,
    recoveryMarkTerminal: 0n,
    recoveryFailClosed: 0n,
    recoveryManualIntervention: 0n,
    hookFailures: 0n,
    fallbackAdvances: 0n,
    streamAborts: 0n,
  })
})

test('SPEC[reliability-counters-006] recording an unknown observation kind throws ArgumentException', () => {
  const store = new ReliabilityDiagnosticsStore()
  assert.throws(() => store.Record('unknownKind'), /unknown reliability observation kind/)
})

test('SPEC[reliability-counters-007] global singletons are available and operable', () => {
  reliabilityDiagnosticsStore.Reset()
  reliabilityDiagnosticsStore.Record('fallbackAdvanced')
  assert.equal(reliabilityDiagnosticsStore.Snapshot().fallbackAdvances, 1n)
  assert.equal(reliabilityCounters.Snapshot().fallbackAdvances, 1n)
  reliabilityDiagnosticsStore.Reset()
})
