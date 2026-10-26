import test from 'node:test'
import assert from 'node:assert/strict'
import { Projection } from '../../../dist/projection/Projection.js'

const p = Projection()
const barrier = { toolCallId: 'review-1', successorTenureId: 'next' }
const m = (id, role, extra = {}) => ({
  id, role, synthetic: false, semantic: true, cursor: null,
  toolCallId: null, resultFor: null, tenureId: null, ...extra,
})

test('SPEC[projection-001] the successor sees nothing at or before the triggering review', () => {
  const messages = [
    m('u-old', 'user', { tenureId: 'old' }),
    m('a-old', 'assistant', { tenureId: 'old' }),
    m('reason-old', 'assistant', { tenureId: 'old' }),
    m('call', 'assistant', { toolCallId: 'review-1', tenureId: 'old' }),
    m('result', 'tool', { resultFor: 'review-1', tenureId: 'old' }),
    m('u-new', 'user', { tenureId: 'next' }),
    m('a-new', 'assistant', { tenureId: 'next' }),
    m('reason-new', 'assistant', { tenureId: 'next' }),
  ]
  const before = JSON.stringify(messages)
  assert.deepEqual(p.tenure(messages, barrier), [5, 6, 7])
  assert.equal(JSON.stringify(messages), before)
})

test('SPEC[projection-001] the cut is the later of the call and its result', () => {
  const messages = [
    m('result', 'tool', { resultFor: 'review-1', tenureId: 'old' }),
    m('between', 'user', { tenureId: 'next' }),
    m('call', 'assistant', { toolCallId: 'review-1', tenureId: 'old' }),
    m('after', 'tool', { tenureId: 'next' }),
  ]
  assert.deepEqual(p.tenure(messages, barrier), [3])
})

test('SPEC[projection-001] host id, another tenure, synthetic rows and unattributed messages stay out', () => {
  const messages = [
    m('call', 'assistant', { toolCallId: 'review-1' }),
    m('result', 'tool', { resultFor: 'review-1' }),
    m('synth', 'user', { tenureId: 'next', synthetic: true }),
    m('other', 'user', { tenureId: 'someone-else' }),
    m('host-only', 'user', { cursor: 9n }),
    m('pending', 'assistant'),
    m('kept', 'tool', { tenureId: 'next' }),
  ]
  assert.deepEqual(p.tenure(messages, barrier), [6])
})

test('SPEC[projection-001] a missing call or result yields nothing', () => {
  assert.deepEqual(p.tenure([
    m('call', 'assistant', { toolCallId: 'review-1', tenureId: 'old' }),
    m('kept', 'user', { tenureId: 'next' }),
  ], barrier), [])
  assert.deepEqual(p.tenure([
    m('result', 'tool', { resultFor: 'review-1', tenureId: 'old' }),
    m('kept', 'user', { tenureId: 'next' }),
  ], barrier), [])
  assert.deepEqual(p.tenure([], barrier), [])
})
