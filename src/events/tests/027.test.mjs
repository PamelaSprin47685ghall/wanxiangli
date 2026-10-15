import test from 'node:test'
import assert from 'node:assert/strict'

import { CanonicalEventCodec } from 'wanxiangli/events'

const codec = new CanonicalEventCodec()

// The authoritative current vocabulary, mirroring the main repo's
// Wanxiangshu.Persistence.EventStore.EventVocabulary.
const currentVocabulary = new Set([
  // current, non-retired types only; retired names below are negative evidence
  'JobRequested', 'StrengthCaseOpened', 'StrengthCaseClosed',
])

// Retired names are kept here only as negative evidence: they must be rejected
// by the current predicate, proving the vocabulary surface is explicit.
const retiredNames = [
  'WorkOpened', 'DevOpsBound', 'IncumbencyOpened', 'ConfirmationCommitted',
  'IncumbencyRetired', 'Reviewed', 'Reopened', 'AdvanceCommitted', 'RetirementBlocked',
]

const event = (id, type) => ({
  id,
  stream: 'job/main',
  type,
  parents: [],
  payload: {},
  payloadRefs: [],
})

const isKnown = type => currentVocabulary.has(type)

test('WHAT[durable-events-027] each retired event type is rejected with UnknownEventType', () => {
  for (const retired of retiredNames) {
    const result = codec.validate([event('a'.repeat(40), retired)], isKnown)
    assert.equal(result.ok, false, retired)
    assert.equal(result.error.code, 'UnknownEventType')
    assert.equal(result.error.eventType, retired)
  }
})

test('WHAT[durable-events-027] removing the retired event lets the remaining history load', () => {
  const root = event('a'.repeat(40), 'JobRequested')
  const child = event('b'.repeat(40), 'StrengthCaseOpened')
  const retired = event('c'.repeat(40), 'Reviewed')

  const rejected = codec.validate([root, child, retired], isKnown)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.eventType, 'Reviewed')

  const accepted = codec.validate([root, child], isKnown)
  assert.equal(accepted.ok, true)
  assert.deepEqual(accepted.events.map(item => item.id).slice(1), ['b'.repeat(40)])
})

test('WHAT[durable-events-027] a current type unknown to a narrower predicate is still rejected', () => {
  // vocabulary legality is per-consumer: the codec itself hardcodes nothing
  const narrow = type => type === 'JobRequested'
  const result = codec.validate([event('a'.repeat(40), 'StrengthCaseOpened')], narrow)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'UnknownEventType')
})
