import test from 'node:test'
import assert from 'node:assert/strict'
import { Projection } from '../../../dist/projection/Projection.js'

const p = Projection()
const barrier = { toolCallId: 'review-1', successorTenureId: 'next' }
const m = (id, role, extra = {}) => ({
  id, role, synthetic: false, semantic: true, cursor: null,
  toolCallId: null, resultFor: null, tenureId: null, ...extra,
})

test('SPEC[projection-002] malformed input is rejected', () => {
  assert.throws(() => p.tenure([], null), /Tenure barrier must be an object/)
  assert.throws(() => p.tenure([], 0n), /Tenure barrier must be an object/)
  assert.throws(() => p.tenure([], { toolCallId: 'review-1' }), /barrier.successorTenureId/)
  assert.throws(() => p.tenure([], { toolCallId: '', successorTenureId: 'next' }), /barrier.toolCallId/)
  assert.throws(() => p.tenure({}, barrier), /messages must be an array/)
  assert.throws(() => p.tenure([, m('u', 'user')], barrier), /must not be sparse/)
  assert.throws(() => p.tenure([null], barrier), /messages\[0\] must be an object/)
  assert.throws(() => p.tenure([m('', 'user')], barrier), /id must be a non-empty string or null/)
  assert.throws(() => p.tenure([m('u', 7)], barrier), /role must be a string/)
  assert.throws(() => p.tenure([m('u', 'user', { cursor: 3 })], barrier), /cursor must be a nonnegative bigint or null/)
  assert.throws(() => p.tenure([m('u', 'user', { cursor: -3n })], barrier), /cursor must be a nonnegative bigint or null/)
  assert.throws(() => p.tenure([m(null, 'user', { cursor: 3n })], barrier), /cursor requires a Host message id/)
  assert.throws(() => p.tenure([m('u', 'user', { synthetic: 'no' })], barrier), /synthetic must be a boolean/)
  assert.throws(() => p.tenure([m('u', 'user', { semantic: 1 })], barrier), /semantic must be a boolean/)
  assert.throws(() => p.tenure([m('u', 'user', { toolCallId: '' })], barrier), /toolCallId must be a non-empty string or null/)
  const missing = m('u', 'user')
  delete missing.tenureId
  assert.throws(() => p.tenure([missing], barrier), /tenureId is required/)
})

test('SPEC[projection-002] accessor fields are refused without being read', () => {
  let reads = 0
  const sneaky = m('a', 'assistant')
  Object.defineProperty(sneaky, 'role', { enumerable: true, get: () => { reads++; return 'assistant' } })
  assert.throws(() => p.tenure([sneaky], barrier), /Accessor field is not accepted: messages\[0\].role/)
  const attributed = m('a', 'assistant')
  Object.defineProperty(attributed, 'tenureId', { enumerable: true, get: () => { reads++; return 'next' } })
  assert.throws(() => p.tenure([attributed], barrier), /Accessor field is not accepted: messages\[0\].tenureId/)
  const list = []
  Object.defineProperty(list, '0', { enumerable: true, get: () => { reads++; return m('u', 'user') } })
  assert.throws(() => p.tenure(list, barrier), /Accessor field is not accepted/)
  assert.equal(reads, 0)
})

test('SPEC[projection-002] answers are frozen and independent of later input edits', () => {
  const messages = [
    m('call', 'assistant', { toolCallId: 'review-1' }),
    m('result', 'tool', { resultFor: 'review-1' }),
    m('kept', 'user', { tenureId: 'next' }),
  ]
  const kept = p.tenure(messages, barrier)
  assert.ok(Object.isFrozen(kept))
  messages[2].tenureId = 'other'
  messages.push(m('x', 'user', { tenureId: 'next' }))
  assert.deepEqual(kept, [2])
})
