import test from 'node:test'
import assert from 'node:assert/strict'
import { Identity } from 'wanxiangli/identity'

const identity = new Identity()

const inheritedView = (name, role, persona = 'Lead') => ({
  name, role, persona, catalogVersion: 1, origin: 'InheritedFromOwner',
})

test('WHAT[participant-identity-010] inherited historical identities decode without upgrading to an active role', () => {
  const owner = identity.resolveAtRoot('manager').evidence
  const decoded = identity.rehydrate(owner, inheritedView('inspector', 'inspector'))
  assert.equal(decoded.ok, true)
  assert.deepEqual(decoded.evidence, inheritedView('inspector', 'inspector'))

  assert.deepEqual(
    identity.rehydrate(owner, inheritedView('inspector', 'engineer')),
    { error: 'RoleMismatch', expected: 'inspector', actual: 'engineer' },
  )
  // 新的继承身份与根选定身份都不享有历史解码例外。
  assert.equal(identity.inheritFromOwner('inspector', owner).error, 'LegacyParticipantName')
  assert.equal(
    identity.rehydrate(null, { ...inheritedView('inspector', 'inspector', 'Investigator'), origin: 'ResolvedAtRoot' }).error,
    'LegacyParticipantName',
  )
  // 非角色历史名（student 等）仍是历史名，不得解出任何角色。
  assert.equal(identity.rehydrate(owner, inheritedView('student', 'engineer')).error, 'LegacyParticipantName')
})

test('WHAT[participant-identity-008] recorded evidence restores without re-demanding the owner witness', () => {
  const owner = identity.resolveAtRoot('manager').evidence
  const child = identity.inheritFromOwner('engineer', owner).evidence
  assert.deepEqual(identity.restoreRecorded(child), { ok: true, evidence: child })
  assert.deepEqual(identity.restoreRecorded(owner), { ok: true, evidence: owner })

  // 根选定证据仍完整重验 persona；继承证据重验名、角色、版本与非空 persona。
  assert.equal(identity.restoreRecorded({ ...owner, persona: 'Engineer' }).error, 'PersonaMismatch')
  assert.equal(identity.restoreRecorded({ ...child, role: 'manager' }).error, 'RoleMismatch')
  assert.equal(identity.restoreRecorded({ ...child, catalogVersion: 2 }).error, 'UnsupportedPersonaCatalogVersion')
  assert.equal(identity.restoreRecorded({ ...child, persona: '' }).error, 'BlankPersona')
  assert.equal(identity.restoreRecorded({ ...child, name: 'Engineer' }).error, 'MalformedParticipantName')
  assert.equal(identity.restoreRecorded(null).error, 'BlankParticipantName')
})

test('WHAT[participant-identity-007] bookkeeper is an internal slot with a null role projection', () => {
  const bookkeeper = identity.resolveAtRoot('bookkeeper').evidence
  assert.deepEqual(bookkeeper, { name: 'bookkeeper', role: null, persona: 'Curator', catalogVersion: 1, origin: 'ResolvedAtRoot' })
  const owner = identity.resolveAtRoot('engineer').evidence
  const inherited = identity.inheritFromOwner('bookkeeper', owner).evidence
  assert.deepEqual(inherited, { name: 'bookkeeper', role: null, persona: 'Engineer', catalogVersion: 1, origin: 'InheritedFromOwner' })
  assert.deepEqual(identity.rehydrate(owner, inherited), { ok: true, evidence: inherited })
  assert.deepEqual(identity.rehydrate(owner, { ...inherited, role: 'engineer' }), { error: 'RoleMismatch', expected: null, actual: 'engineer' })
})
