import test from 'node:test'
import assert from 'node:assert/strict'
import { Projection } from '../../../dist/projection/Projection.js'

const p = Projection()
const m = (id, role, cursor = null, extra = {}) => ({ id, role, synthetic: false, semantic: true, cursor, ...extra })

test('SPEC[projection-001] user messages always stay, in order', () => {
  assert.deepEqual(p.tenure([m('u1', 'user', 1n), m('u2', 'user', 2n), m(null, 'user', null, { semantic: false })], 100n), [0, 1, 2])
})

test('SPEC[projection-001] earlier-tenure exchanges are stripped; at or after the opening they stay', () => {
  const messages = [m('u1', 'user', 1n), m('a-old', 'assistant', 9n), m('t-old', 'tool', 19n), m('a-at', 'assistant', 20n), m('t-new', 'tool', 30n)]
  assert.deepEqual(p.tenure(messages, 20n), [0, 3, 4])
  assert.deepEqual(p.tenure(messages, 0n), [0, 1, 2, 3, 4])
})

test('SPEC[projection-001] an identified but uncaptured exchange belongs to the current tenure', () => {
  assert.deepEqual(p.tenure([m('a-new', 'assistant', null), m('t-new', 'tool', null)], 50n), [0, 1])
})

test('SPEC[projection-001] synthetic rows and unknown roles are stripped', () => {
  const messages = [m('u1', 'user', 1n, { synthetic: true }), m('a1', 'assistant', 99n, { synthetic: true }), m('s1', 'system', 99n)]
  assert.deepEqual(p.tenure(messages, 0n), [])
})

test('SPEC[projection-001] an unidentified exchange: empty is stripped, semantic is a contract violation', () => {
  assert.deepEqual(p.tenure([m(null, 'assistant', null, { semantic: false }), m(null, 'tool', null, { semantic: false })], 0n), [])
  assert.throws(() => p.tenure([m(null, 'assistant', null)], 0n), /Plan interaction has no stable XTrace message identity/)
  assert.throws(() => p.tenure([m(null, 'tool', null)], 0n), /Plan interaction has no stable XTrace message identity/)
})
