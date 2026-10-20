import test from 'node:test'
import assert from 'node:assert/strict'

import { SessionAssociationLaw } from 'wanxiangli/association'

const law = new SessionAssociationLaw()
const plain = (v) => JSON.parse(JSON.stringify(v))
const link = (over) => plain(law.link({
  main: 'w', satellite: 'c', satelliteKind: 'Companion',
  mainEntry: null, satelliteEntry: null, existingSatellite: null, parentOfMain: null, ...over,
}))
const W = (parent = null) => ({ kind: 'Work', parent })
const C = (owner) => ({ kind: 'Satellite', owner, satelliteKind: 'Companion' })

test('SPEC[association-1] a fresh link is accepted; the proposed parent wins, else main keeps its recorded parent', () => {
  assert.deepEqual(link({}), { verdict: 'link', mainParent: null })
  assert.deepEqual(link({ parentOfMain: 'p' }), { verdict: 'link', mainParent: 'p' })
  assert.deepEqual(link({ mainEntry: W('old') }), { verdict: 'link', mainParent: 'old' })
  assert.deepEqual(link({ mainEntry: W('old'), parentOfMain: 'new' }), { verdict: 'link', mainParent: 'new' })
})

test('SPEC[association-1] counterexample: restart recovery re-links the same pair idempotently', () => {
  assert.deepEqual(link({ mainEntry: W('p'), satelliteEntry: C('w'), existingSatellite: 'c' }), { verdict: 'link', mainParent: 'p' })
})

test('SPEC[association-1] counterexample: no self link, no companion of a companion, no second companion, no stolen companion', () => {
  assert.deepEqual(link({ satellite: 'w' }), { verdict: 'reject', rejection: 'SelfLink', session: 'w' })
  assert.deepEqual(link({ mainEntry: C('x') }), { verdict: 'reject', rejection: 'CompanionWouldRecurse', companion: 'w' })
  assert.deepEqual(link({ existingSatellite: 'c2' }), { verdict: 'reject', rejection: 'AlreadyLinkedToOther', existing: 'c2', proposed: 'c' })
  assert.deepEqual(link({ satelliteEntry: C('w2') }), { verdict: 'reject', rejection: 'CompanionClaimedByOther', owner: 'w2', proposed: 'c' })
  assert.deepEqual(link({ satelliteEntry: W() }), { verdict: 'reject', rejection: 'SatelliteKindConflict', proposed: 'c' })
  assert.deepEqual(link({ satelliteEntry: { kind: 'Satellite', owner: 'w', satelliteKind: 'Other' } }), { verdict: 'reject', rejection: 'SatelliteKindConflict', proposed: 'c' })
})

test('SPEC[association-1] the judgement order is fixed', () => {
  // self link beats every other conflict
  assert.equal(link({ satellite: 'w', mainEntry: C('x'), existingSatellite: 'z' }).rejection, 'SelfLink')
  // recursion beats a second companion
  assert.equal(link({ mainEntry: C('x'), existingSatellite: 'z' }).rejection, 'CompanionWouldRecurse')
  // a second companion beats a stolen one
  assert.equal(link({ existingSatellite: 'z', satelliteEntry: C('w2') }).rejection, 'AlreadyLinkedToOther')
  // a stolen companion beats a kind conflict
  assert.equal(link({ satelliteEntry: { kind: 'Satellite', owner: 'w2', satelliteKind: 'Other' } }).rejection, 'CompanionClaimedByOther')
})

test('SPEC[association-1] malformed input is refused and verdicts are frozen', () => {
  assert.throws(() => law.link(null), /input/)
  assert.throws(() => link({ main: 1 }), /main/)
  assert.throws(() => link({ mainEntry: { kind: 'Leaf' } }), /mainEntry.kind/)
  assert.throws(() => link({ satelliteEntry: { kind: 'Satellite' } }), /owner/)
  assert.ok(Object.isFrozen(law.link({ main: 'a', satellite: 'b', satelliteKind: 'Companion', mainEntry: null, satelliteEntry: null, existingSatellite: null, parentOfMain: null })))
})
