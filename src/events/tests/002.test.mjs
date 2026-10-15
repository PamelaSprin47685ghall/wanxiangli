import test from 'node:test'
import assert from 'node:assert/strict'

import { CanonicalEventCodec } from 'wanxiangli/events'

const codec = new CanonicalEventCodec()

const event = (overrides = {}) => ({
  id: 'a'.repeat(40),
  stream: 'job/main',
  type: 'JobRequested',
  parents: [],
  payload: { status: 'open' },
  payloadRefs: [],
  ...overrides,
})

test('WHAT[durable-events-002] envelope carries the seven fixed wire fields and no version field', () => {
  const body = JSON.parse(codec.encode(event()).trimEnd())
  assert.deepEqual(Object.keys(body).sort(), [
    'event_id', 'event_type', 'parents', 'payload', 'payload_refs', 'stream_id',
  ])
  assert.equal('payloads' in body, false)
})

test('WHAT[durable-events-002] decode rejects an injected version field', () => {
  const base = JSON.parse(codec.encode(event()).trimEnd())
  const withVersion = `${JSON.stringify({ ...base, version: 1 })}\n`
  const decoded = codec.tryDecode(withVersion)
  assert.equal(decoded.ok, false)
  assert.equal(decoded.error.code, 'NonCanonical')
})

test('WHAT[durable-events-002] decode rejects a renamed wire field', () => {
  const base = JSON.parse(codec.encode(event()).trimEnd())
  const { event_id: eventId, ...rest } = base
  const renamed = `${JSON.stringify({ id: eventId, ...rest })}\n`
  const decoded = codec.tryDecode(renamed)
  assert.equal(decoded.ok, false)
})

test('WHAT[durable-events-002] vocabulary legality comes only from the explicit predicate', () => {
  const known = new Set(['JobRequested'])
  const rejected = codec.validate([event({ type: 'StrengthCaseOpened' })], type => known.has(type))
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'UnknownEventType')
  assert.equal(rejected.error.eventType, 'StrengthCaseOpened')
  const widened = codec.validate([event({ type: 'StrengthCaseOpened' })], () => true)
  assert.equal(widened.ok, true)
})
