import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PairGuidanceMemoryStore,
  pairGuidanceMemoryStore,
  pairGuidanceSource
} from '../../../dist/pair-hint/PairHint.js'

test('SPEC[pair-hint-017] memory ledger maintains session-isolated read and append with defensive snapshot', () => {
  const store = new PairGuidanceMemoryStore()
  assert.equal(store.source, 'pair-programming-auto-injected')
  assert.equal(pairGuidanceSource, 'pair-programming-auto-injected')

  // Empty read returns defensive empty array
  const empty = store.read('session-a')
  assert.deepEqual(Array.from(empty), [])

  // Append camelCase item
  store.append('session-a', {
    ordinal: 1n,
    callId: 'call-1',
    markerText: 'marker-1',
    callGapKey: 'Start',
    resultGapKey: 'Before:msg-1'
  })

  // Append PascalCase item (from F# host record)
  store.append('session-a', {
    Ordinal: 2n,
    CallId: 'call-2',
    MarkerText: 'marker-2',
    CallGapKey: 'Before:msg-1',
    ResultGapKey: 'After:msg-1'
  })

  // Session B remains isolated
  assert.deepEqual(Array.from(store.read('session-b')), [])

  // Read session A
  const readA = store.read('session-a')
  assert.equal(readA.length, 2)
  assert.equal(readA[0].callId, 'call-1')
  assert.equal(readA[0].callGapKey, 'Start')
  assert.equal(readA[0].resultGapKey, 'Before:msg-1')
  assert.equal(readA[1].callId, 'call-2')
  assert.equal(readA[1].callGapKey, 'Before:msg-1')
  assert.equal(readA[1].resultGapKey, 'After:msg-1')

  // Defensive snapshot copy: mutating returned array does not corrupt internal state
  readA.pop()
  assert.equal(readA.length, 1)
  assert.equal(store.read('session-a').length, 2, 'internal state preserved after external pop')
})

test('SPEC[pair-hint-017] clear and clearAll perform idempotent session-isolated cleanup', () => {
  const store = new PairGuidanceMemoryStore()
  store.append('session-1', { ordinal: 1n, callId: 'c1' })
  store.append('session-2', { ordinal: 1n, callId: 'c2' })

  // Clear single session
  store.clear('session-1')
  assert.deepEqual(Array.from(store.read('session-1')), [])
  assert.equal(store.read('session-2').length, 1)

  // Clear idempotent
  store.clear('session-1')
  store.clear('non-existent')

  // ClearAll
  store.clearAll()
  assert.deepEqual(Array.from(store.read('session-2')), [])
})

test('SPEC[pair-hint-017] nextOrdinal computes incremental sequence faithfully', () => {
  const store = new PairGuidanceMemoryStore()

  // Empty returns 1n
  assert.equal(store.nextOrdinal([]), 1n)
  assert.equal(store.nextOrdinal(null), 1n)

  // Non-empty with bigint
  assert.equal(store.nextOrdinal([{ ordinal: 5n }]), 6n)
  assert.equal(store.nextOrdinal([{ Ordinal: 9n }]), 10n)

  // Non-empty with number
  assert.equal(store.nextOrdinal([{ ordinal: 3 }]), 4n)

  // Sequence of items takes the last
  const history = [
    { ordinal: 1n, callId: 'c1' },
    { ordinal: 2n, callId: 'c2' },
    { ordinal: 3n, callId: 'c3' }
  ]
  assert.equal(store.nextOrdinal(history), 4n)
})

test('SPEC[pair-hint-017] isOccupied strictly enforces simultaneous callGapKey and resultGapKey match', () => {
  const store = new PairGuidanceMemoryStore()
  const visible = [
    { callGapKey: 'Start', resultGapKey: 'Before:msg-1' },
    { CallGapKey: 'Before:msg-1', ResultGapKey: 'After:msg-1' }
  ]

  // Both match
  assert.equal(store.isOccupied(visible, 'Start', 'Before:msg-1'), true)
  assert.equal(store.isOccupied(visible, 'Before:msg-1', 'After:msg-1'), true)

  // Only callGapKey matches
  assert.equal(store.isOccupied(visible, 'Start', 'After:msg-1'), false)

  // Only resultGapKey matches
  assert.equal(store.isOccupied(visible, 'Before:msg-1', 'Before:msg-1'), false)

  // Neither matches
  assert.equal(store.isOccupied(visible, 'After:msg-2', 'After:msg-3'), false)

  // Empty visible returns false
  assert.equal(store.isOccupied([], 'Start', 'Before:msg-1'), false)
})

test('SPEC[pair-hint-017] findOrphanedCallIds identifies synthetic call IDs without durable record', () => {
  const store = new PairGuidanceMemoryStore()
  const history = [
    { callId: 'known-1' },
    { CallId: 'known-2' }
  ]

  // Some orphaned
  const synthetic = ['known-1', 'orphan-1', 'known-2', 'orphan-2']
  const orphaned = store.findOrphanedCallIds(history, synthetic)
  assert.deepEqual(Array.from(orphaned), ['orphan-1', 'orphan-2'])

  // All known
  assert.deepEqual(Array.from(store.findOrphanedCallIds(history, ['known-1', 'known-2'])), [])

  // All orphaned
  assert.deepEqual(Array.from(store.findOrphanedCallIds(history, ['orphan-a', 'orphan-b'])), ['orphan-a', 'orphan-b'])

  // Empty synthetic
  assert.deepEqual(Array.from(store.findOrphanedCallIds(history, [])), [])
})

test('SPEC[pair-hint-017] stableCallId produces deterministic 24-character prefixed hex digest', () => {
  const store = new PairGuidanceMemoryStore()
  const id1 = store.stableCallId('session-x', 1n)
  const id2 = store.stableCallId('session-x', 1n)
  assert.equal(id1, id2, 'deterministic output for identical input')
  assert.ok(id1.startsWith('pair-programming-auto-injected-'))
  // Prefix length is 31 chars + 24 hex = 55 chars
  assert.equal(id1.length, 31 + 24)

  // Different ordinal produces different callId
  const id3 = store.stableCallId('session-x', 2n)
  assert.notEqual(id1, id3)

  // Different session produces different callId
  const id4 = store.stableCallId('session-y', 1n)
  assert.notEqual(id1, id4)
})

test('SPEC[pair-hint-017] global singleton pairGuidanceMemoryStore is isolated from independent instances', () => {
  const independent = new PairGuidanceMemoryStore()
  pairGuidanceMemoryStore.clearAll()

  pairGuidanceMemoryStore.append('session-shared', { ordinal: 1n, callId: 'shared-1' })
  assert.equal(pairGuidanceMemoryStore.read('session-shared').length, 1)
  assert.equal(independent.read('session-shared').length, 0, 'independent instance is isolated from singleton')

  pairGuidanceMemoryStore.clearAll()
})
