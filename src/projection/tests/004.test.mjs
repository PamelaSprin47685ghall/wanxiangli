import test from 'node:test'
import assert from 'node:assert/strict'
import { Projection } from '../../../dist/projection/Projection.js'

const p = Projection()
const m = (role, id = null, cut = false, accepted = null) => ({ role, id, cut, accepted })
const req = (messages, over = {}) => ({ relayed: true, acceptedRequest: false, activeRoot: null, gatePhysical: null, messages, ...over })

test('SPEC[projection-004] nothing is stale without a Relayed retirement with a projection cut', () => {
  assert.equal(p.retired(req([m('assistant', 'a', true), m('user', 'u1')], { relayed: false })), false)
  assert.equal(p.retired(req([], { relayed: false })), false)
})

test('SPEC[projection-004] a request still carrying the retired cut and no successor evidence is stale', () => {
  assert.equal(p.retired(req([m('user', 'u0'), m('assistant', 'a', true), m('tool', 't', true)])), true)
  assert.equal(p.retired(req([])), true)
  // a later user message alone is not successor evidence
  assert.equal(p.retired(req([m('assistant', 'a', true), m('user', 'u1')])), true)
})

test('SPEC[projection-004] a fresh root after the cut belongs to the successor; before the cut it does not', () => {
  assert.equal(p.retired(req([m('assistant', 'a', true), m('USER', 'u1')], { activeRoot: 'u1' })), false)
  assert.equal(p.retired(req([m('user', 'u1'), m('assistant', 'a', true)], { activeRoot: 'u1' })), true)
})

test('SPEC[projection-004] the accepted gate nudge belongs to the successor wherever the cut is', () => {
  assert.equal(p.retired(req([m('user', 'g'), m('assistant', 'a', true)], { gatePhysical: 'g' })), false)
  assert.equal(p.retired(req([m('user', 'g'), m('assistant', 'a', true)], { gatePhysical: 'h' })), true)
})

test('SPEC[projection-004] an accepted request after the cut belongs to the successor; before it does not', () => {
  assert.equal(p.retired(req([m('assistant', 'a', true), m('user', 'u1')], { acceptedRequest: true })), false)
  assert.equal(p.retired(req([m('user', 'u1'), m('assistant', 'a', true)], { acceptedRequest: true })), true)
})

test('SPEC[projection-004] acceptance under the current root counts only once the cut is gone from the wire', () => {
  assert.equal(p.retired(req([m('user', 'u1', false, 'R')], { activeRoot: 'R' })), false)
  assert.equal(p.retired(req([m('user', 'u1', false, 'R')], { activeRoot: 'S' })), true)
  assert.equal(p.retired(req([m('user', 'u1', false, 'R')])), true)
  assert.equal(p.retired(req([m('assistant', 'a', true), m('user', 'u1', false, 'R')], { activeRoot: 'R' })), true)
  // only the last user message's own acceptance counts
  assert.equal(p.retired(req([m('user', 'u0', false, 'R'), m('user', 'u1')], { activeRoot: 'R' })), true)
})

test('SPEC[projection-004] a last user message without a Host id never proves succession', () => {
  const messages = [m('assistant', 'a', true), m('user', null, false, 'R')]
  assert.equal(p.retired(req(messages, { activeRoot: 'R', acceptedRequest: true, gatePhysical: 'R' })), true)
  assert.equal(p.retired(req([m('user', null, false, 'R')], { activeRoot: 'R' })), true)
})

test('SPEC[projection-004] the cut is the first message carrying it; role match is case-insensitive', () => {
  const messages = [m('assistant', 'a', true), m('User', 'u1'), m('tool', 't', true)]
  assert.equal(p.retired(req(messages, { acceptedRequest: true })), false)
})

test('SPEC[projection-004] malformed requests are refused and accessors are not read', () => {
  assert.throws(() => p.retired(null), /request must be an object/)
  assert.throws(() => p.retired(req([m('user', 'u')], { relayed: 'yes' })), /relayed must be a boolean/)
  assert.throws(() => p.retired(req([m('user', '')])), /id must be a non-empty string or null/)
  assert.throws(() => p.retired(req([m(3, 'u')])), /role must be a string or null/)
  assert.throws(() => p.retired(req([{ role: 'user', id: 'u', accepted: null }])), /cut must be a boolean/)
  assert.throws(() => p.retired(req({})), /request.messages must be an array/)
  const sparse = [m('user', 'u')]; sparse.length = 3
  assert.throws(() => p.retired(req(sparse)), /must not be sparse/)
  let read = false
  const trap = { role: 'user', id: 'u', cut: false, get accepted() { read = true; return null } }
  assert.throws(() => p.retired(req([trap])), /Accessor field is not accepted/)
  assert.equal(read, false)
})
