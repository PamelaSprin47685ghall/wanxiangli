import test from 'node:test'
import assert from 'node:assert/strict'
import { Identity } from 'wanxiangli/identity'

const identity = new Identity()

test('WHAT[participant-identity-005] inherited identity carries the owner persona and catalog version', () => {
  const owner = identity.resolveAtRoot('manager')
  const child = identity.inheritFromOwner('engineer', owner.evidence)
  assert.deepEqual(child, {
    ok: true,
    evidence: {
      name: 'engineer',
      role: 'engineer',
      persona: 'Lead',
      catalogVersion: 1,
      origin: 'InheritedFromOwner'
    }
  })
  const roundTrip = identity.rehydrate(owner.evidence, child.evidence)
  assert.deepEqual(roundTrip, child)
})

test('WHAT[participant-identity-005] inherited identity without an owner witness is rejected', () => {
  const owner = identity.resolveAtRoot('manager')
  const child = identity.inheritFromOwner('engineer', owner.evidence)
  assert.equal(child.ok, true)
  assert.equal(identity.rehydrate(null, child.evidence).error, 'OwnerRequired')
  assert.equal(identity.inheritFromOwner('coder', owner.evidence).error, 'LegacyParticipantName')
  assert.equal(identity.inheritFromOwner(null, owner.evidence).error, 'BlankParticipantName')
})

test('WHAT[participant-identity-005] owner persona mismatch between witness and input is rejected', () => {
  const owner = identity.resolveAtRoot('manager')
  const child = identity.inheritFromOwner('engineer', owner.evidence)
  const forged = { ...child.evidence, persona: 'Engineer' }
  assert.deepEqual(identity.rehydrate(owner.evidence, forged), { error: 'OwnerPersonaMismatch', expected: 'Lead', actual: 'Engineer' })

  const wrongOwner = identity.resolveAtRoot('engineer')
  assert.equal(identity.rehydrate(wrongOwner.evidence, child.evidence).error, 'OwnerPersonaMismatch')
  assert.deepEqual(
    identity.rehydrate(owner.evidence, owner.evidence),
    { error: 'OriginMismatch', expected: 'InheritedFromOwner', actual: 'ResolvedAtRoot' },
  )

  const staleChild = { ...child.evidence, catalogVersion: 2 }
  assert.equal(
    identity.rehydrate(owner.evidence, staleChild).error,
    'UnsupportedPersonaCatalogVersion'
  )
  // 无效的 owner 视图按自身错误拒绝，不会被静默丢弃成"无 owner"。
  const invalidOwnerView = { ...owner.evidence, catalogVersion: 2 }
  assert.equal(identity.rehydrate(invalidOwnerView, child.evidence).error, 'UnsupportedPersonaCatalogVersion')
})

test('WHAT[participant-identity-005] agent-owner-root origin proof and inherited identity compose', () => {
  const origin = identity.classifyOrigin({
    kind: 'agent-owner-root',
    ownerLogicalRun: 'run-1',
    childLogicalRun: 'run-2',
    childParticipant: 'engineer'
  })
  assert.equal(origin.ok, true)
  const owner = identity.resolveAtRoot('manager')
  const child = identity.inheritFromOwner('engineer', owner.evidence)
  assert.equal(child.ok, true)
  // 来源证明与身份证据各自独立成立：来源说清"从哪来"，身份说清"是谁"。
  assert.equal(origin.origin.childParticipant, child.evidence.name)
  assert.equal(origin.origin.ownerLogicalRun, 'run-1')
})
