import test from 'node:test'
import assert from 'node:assert/strict'
import { Projection } from '../../../dist/projection/Projection.js'

const p = Projection()
const barrier = { toolCallId: 'review-1', successorTenureId: 'next' }
const m = (id, role, extra = {}) => ({
  id, role, synthetic: false, semantic: true, cursor: null,
  toolCallId: null, resultFor: null, tenureId: null, ...extra,
})

test('SPEC[projection-001] the successor sees every user message and the triggering review turn, nothing else at or before it', () => {
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
  assert.deepEqual(p.tenure(messages, barrier), [0, 3, 4, 5, 6, 7])
  assert.equal(JSON.stringify(messages), before)
})

test('SPEC[projection-001] the cut is the later of the call and its result', () => {
  const messages = [
    m('result', 'tool', { resultFor: 'review-1', tenureId: 'old' }),
    m('before-cut', 'assistant', { tenureId: 'next' }),
    m('between', 'user', { tenureId: 'next' }),
    m('call', 'assistant', { toolCallId: 'review-1', tenureId: 'old' }),
    m('after', 'tool', { tenureId: 'next' }),
  ]
  assert.deepEqual(p.tenure(messages, barrier), [0, 2, 3, 4])
})

test('SPEC[projection-001] synthetic rows and non-user rows of another tenure, host id only or no attribution stay out; user rows and the triggering turn stay in', () => {
  const messages = [
    m('call', 'assistant', { toolCallId: 'review-1' }),
    m('result', 'tool', { resultFor: 'review-1' }),
    m('synth', 'user', { tenureId: 'next', synthetic: true }),
    m('other', 'user', { tenureId: 'someone-else' }),
    m('host-only', 'user', { cursor: 9n }),
    m('pending', 'assistant'),
    m('kept', 'tool', { tenureId: 'next' }),
    m('other-tool', 'tool', { tenureId: 'someone-else' }),
    m('host-only-assistant', 'assistant', { cursor: 10n }),
    m('upper', 'USER'),
  ]
  assert.deepEqual(p.tenure(messages, barrier), [0, 1, 3, 4, 6, 9])
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

test('SPEC[projection-001] the root request and its attached guide survive a relay that emptied the ledger', () => {
  // ses.txt：前任记账后用 null 删光义务，空账触发接力。后任仍须看见用户原话。
  const messages = [
    m('root', 'user', { tenureId: 'old' }),
    m('guide', 'user', { tenureId: 'old' }),
    m('record', 'assistant', { toolCallId: 'review-0', tenureId: 'old' }),
    m('recorded', 'tool', { resultFor: 'review-0', tenureId: 'old' }),
    m('clear', 'assistant', { toolCallId: 'review-1', tenureId: 'old' }),
    m('relayed', 'tool', { resultFor: 'review-1', tenureId: 'old' }),
    m('handover', 'user', { tenureId: 'next', synthetic: true }),
    m('start', 'assistant', { tenureId: 'next' }),
  ]
  assert.deepEqual(p.tenure(messages, barrier), [0, 1, 4, 5, 7])
})
