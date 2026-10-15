import test from 'node:test'
import assert from 'node:assert/strict'

import { CanonicalEventCodec } from 'wanxiangli/events'

const codec = new CanonicalEventCodec()

const event = (id, parents = []) => ({
  id,
  stream: 'job/main',
  type: 'JobRequested',
  parents,
  payload: {},
  payloadRefs: [],
})

test('WHAT[durable-events-007] validate fails closed on a missing parent', () => {
  const root = event('a'.repeat(40))
  const child = event('b'.repeat(40), ['a'.repeat(40)])
  const orphan = event('c'.repeat(40), ['e'.repeat(40)])

  const result = codec.validate([root, child, orphan], () => true)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'MissingParent')
  assert.equal(result.error.eventId, 'e'.repeat(40))
})

test('WHAT[durable-events-007] validate fails closed on a parent cycle', () => {
  const a = 'a'.repeat(40)
  const b = 'b'.repeat(40)

  const result = codec.validate([event(a, [b]), event(b, [a])], () => true)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'CyclicParents')
})

test('WHAT[durable-events-007] validate reports the first unknown vocabulary item, not a skip', () => {
  const result = codec.validate([event('a'.repeat(40), []), event('b'.repeat(40), ['a'.repeat(40)])], () => false)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'UnknownEventType')
})

test('WHAT[durable-events-007] a self-parent is a cycle, not a head', () => {
  const a = 'a'.repeat(40)
  const result = codec.validate([event(a, [a])], () => true)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'CyclicParents')
})
