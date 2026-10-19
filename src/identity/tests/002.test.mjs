import test from 'node:test'
import assert from 'node:assert/strict'
import { Identity } from 'wanxiangli/identity'

const identity = new Identity()

test('WHAT[participant-identity-002] root resolution yields immutable canonical evidence', () => {
  const resolved = identity.resolveAtRoot('engineer')
  assert.deepEqual(resolved, {
    ok: true,
    evidence: { name: 'engineer', role: 'engineer', persona: 'Engineer', catalogVersion: 1, origin: 'ResolvedAtRoot' }
  })
  const manager = identity.resolveAtRoot('manager')
  assert.equal(manager.evidence.persona, 'Lead')
  const devops = identity.resolveAtRoot('devops')
  assert.equal(devops.evidence.persona, 'Operator')
})

test('WHAT[participant-identity-002] root resolution rejects legacy, malformed and unknown names without fallback', () => {
  assert.deepEqual(identity.resolveAtRoot('coder'), { error: 'LegacyParticipantName', detail: 'coder' })
  assert.deepEqual(identity.resolveAtRoot('student'), { error: 'LegacyParticipantName', detail: 'student' })
  assert.deepEqual(identity.resolveAtRoot('Fast_Engineer'), { error: 'LegacyParticipantName', detail: 'Fast_Engineer' })
  assert.deepEqual(identity.resolveAtRoot('no-such-name'), { error: 'UnknownParticipantName', detail: 'no-such-name' })
  assert.equal(identity.resolveAtRoot('').error, 'BlankParticipantName')
  assert.equal(identity.resolveAtRoot(null).error, 'BlankParticipantName')
  assert.equal(identity.resolveAtRoot(42).error, 'BlankParticipantName')
})

test('WHAT[participant-identity-002] internal slot names resolve with explicit role projection', () => {
  const bookkeeper = identity.resolveAtRoot('bookkeeper')
  assert.equal(bookkeeper.ok, true)
  assert.equal(bookkeeper.evidence.role, null)
  assert.equal(bookkeeper.evidence.persona, 'Curator')
})

test('WHAT[participant-identity-002] retired slot names resolve to no identity, never to a live role', () => {
  for (const retired of ['predictor', 'chronicler']) {
    const resolved = identity.resolveAtRoot(retired)
    assert.equal(resolved.ok, undefined, `${retired} must not resolve to an identity`)
    assert.equal(resolved.evidence, undefined, `${retired} must not carry identity evidence`)
    assert.equal(resolved.error, 'UnknownParticipantName')
    assert.equal(resolved.detail, retired)
    const inherited = identity.inheritFromOwner(retired, identity.resolveAtRoot('engineer').evidence)
    assert.equal(inherited.ok, undefined, `${retired} must not be inheritable`)
    assert.equal(inherited.error, 'UnknownParticipantName')
    assert.equal(inherited.detail, retired)
  }
})

test('WHAT[participant-identity-002] rehydrated evidence round-trips through the plain view', () => {
  const resolved = identity.resolveAtRoot('engineer')
  const rehydrated = identity.rehydrate(null, resolved.evidence)
  assert.deepEqual(rehydrated, resolved)
})

test('WHAT[participant-identity-002] rehydration rejects every field mismatch', () => {
  const resolved = identity.resolveAtRoot('engineer')
  const base = resolved.evidence
  assert.equal(identity.rehydrate(null, { ...base, role: 'manager' }).error, 'RoleMismatch')
  assert.equal(identity.rehydrate(null, { ...base, persona: 'Lead' }).error, 'PersonaMismatch')
  assert.equal(identity.rehydrate(null, { ...base, catalogVersion: 2 }).error, 'UnsupportedPersonaCatalogVersion')
  assert.equal(identity.rehydrate(null, { ...base, origin: 'InheritedFromOwner' }).error, 'OwnerRequired')
  assert.equal(identity.rehydrate(null, { ...base, origin: 'weird' }).error, 'OriginMismatch')
  assert.equal(identity.rehydrate(null, { ...base, name: 'coder' }).error, 'LegacyParticipantName')
  assert.equal(identity.rehydrate(null, null).error, 'BlankParticipantName')
})

test('WHAT[participant-identity-002] bookkeeper evidence requires a missing role field', () => {
  const bookkeeper = identity.resolveAtRoot('bookkeeper')
  const withRole = { ...bookkeeper.evidence, role: 'manager' }
  assert.equal(identity.rehydrate(null, bookkeeper.evidence).ok, true)
  assert.equal(identity.rehydrate(null, withRole).error, 'RoleMismatch')
})
