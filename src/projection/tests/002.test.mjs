import test from 'node:test'
import assert from 'node:assert/strict'
import { Projection } from '../../../dist/projection/Projection.js'

const p = Projection()
const m = (id, role, cursor = null, extra = {}) => ({ id, role, synthetic: false, semantic: true, cursor, ...extra })

test('SPEC[projection-002] malformed input is rejected', () => {
  assert.throws(() => p.tenure([], -1n), /opening cursor must be a nonnegative bigint/)
  assert.throws(() => p.tenure([], 0), /opening cursor must be a nonnegative bigint/)
  assert.throws(() => p.tenure({}, 0n), /messages must be an array/)
  assert.throws(() => p.tenure([, m('u', 'user')], 0n), /must not be sparse/)
  assert.throws(() => p.tenure([null], 0n), /messages\[0\] must be an object/)
  assert.throws(() => p.tenure([m('', 'user')], 0n), /id must be a non-empty string or null/)
  assert.throws(() => p.tenure([m('u', 7)], 0n), /role must be a string/)
  assert.throws(() => p.tenure([m('u', 'user', 3)], 0n), /cursor must be a nonnegative bigint or null/)
  assert.throws(() => p.tenure([m('u', 'user', -3n)], 0n), /cursor must be a nonnegative bigint or null/)
  assert.throws(() => p.tenure([m(null, 'user', 3n)], 0n), /cursor requires a Host message id/)
  assert.throws(() => p.tenure([m('u', 'user', null, { synthetic: 'no' })], 0n), /synthetic must be a boolean/)
  assert.throws(() => p.tenure([m('u', 'user', null, { semantic: 1 })], 0n), /semantic must be a boolean/)
})

test('SPEC[projection-002] accessor fields are refused without being read', () => {
  let reads = 0
  const sneaky = { id: 'a', synthetic: false, semantic: true, cursor: 1n }
  Object.defineProperty(sneaky, 'role', { enumerable: true, get: () => { reads++; return 'assistant' } })
  assert.throws(() => p.tenure([sneaky], 0n), /Accessor field is not accepted: messages\[0\].role/)
  const list = []
  Object.defineProperty(list, '0', { enumerable: true, get: () => { reads++; return m('u', 'user') } })
  assert.throws(() => p.tenure(list, 0n), /Accessor field is not accepted/)
  assert.equal(reads, 0)
})

test('SPEC[projection-002] answers are frozen and independent of later input edits', () => {
  const messages = [m('u', 'user'), m('a', 'assistant', 5n)]
  const kept = p.tenure(messages, 0n)
  assert.ok(Object.isFrozen(kept))
  messages[1].cursor = 0n
  messages.push(m('x', 'user'))
  assert.deepEqual(kept, [0, 1])
})
