import test from 'node:test'
import assert from 'node:assert/strict'
import { Identity } from 'wanxiangli/identity'

const identity = new Identity()

const activeRoles = ['orchestrator', 'manager', 'engineer', 'devops', 'plan']
const historicalRoles = ['coder', 'inspector', 'browser', 'inquiry', 'distiller']

test('WHAT[participant-identity-001] active parsing accepts exactly the five active roles', () => {
  for (const role of activeRoles) {
    assert.equal(identity.tryParseRole(role), role)
  }
  assert.equal(identity.tryParseRole('Engineer'), 'engineer')
  assert.equal(identity.tryParseRole('DEVOPS'), 'devops')
  assert.equal(identity.tryParseHistoricalRole('Coder'), 'coder')
})

test('WHAT[participant-identity-001] active parsing rejects historical, internal and malformed inputs', () => {
  for (const name of [...historicalRoles, 'blogger', 'chronicler', 'predictor', 'bookkeeper', 'student', 'build', 'Fast_Engineer']) {
    assert.equal(identity.tryParseRole(name), null, `${name} must not resolve to an active role`)
  }
  assert.equal(identity.tryParseRole(''), null)
  assert.equal(identity.tryParseRole(null), null)
  assert.equal(identity.tryParseRole(42), null)
  assert.equal(identity.tryParseRole(undefined), null)
})

test('WHAT[participant-identity-001] historical decoding accepts all ten roles for journal replay only', () => {
  for (const role of [...activeRoles, ...historicalRoles]) {
    assert.equal(identity.tryParseHistoricalRole(role), role)
  }
  assert.equal(identity.tryParseHistoricalRole('CODER'.toLowerCase()), 'coder')
  assert.equal(identity.tryParseHistoricalRole('blogger'), null)
  assert.equal(identity.tryParseHistoricalRole('chronicler'), null)
  assert.equal(identity.tryParseHistoricalRole('predictor'), null)
  assert.equal(identity.tryParseHistoricalRole('bookkeeper'), null)
  assert.equal(identity.tryParseHistoricalRole('no-such-role'), null)
})

test('WHAT[participant-identity-001] persona catalog maps every role to its V1 persona', () => {
  assert.equal(identity.personaOfRole('manager'), 'Lead')
  assert.equal(identity.personaOfRole('orchestrator'), 'Director')
  assert.equal(identity.personaOfRole('engineer'), 'Engineer')
  assert.equal(identity.personaOfRole('devops'), 'Operator')
  assert.equal(identity.personaOfRole('plan'), 'Planner')
  assert.equal(identity.bookkeeperPersona(), 'Curator')
  assert.equal(identity.personaOfRole('advisor'), null)
  assert.equal(identity.personaOfRole('blogger'), null)
  assert.equal(identity.personaOfRole('chronicler'), null)
  assert.equal(identity.personaOfRole('predictor'), null)
  assert.equal(identity.personaOfRole('coder'), 'Coder')
  assert.equal(identity.personaOfRole(null), null)
  assert.equal(identity.personaOfRole('no-such-role'), null)
})

test('WHAT[participant-identity-001] role catalog exposes ordered active, historical and internal vocabularies', () => {
  assert.deepEqual(identity.activeRoleLabels(), activeRoles)
  assert.deepEqual(identity.historicalRoleLabels(), historicalRoles)
  assert.equal(identity.isInternalRole('distiller'), true)
  for (const role of ['orchestrator', 'manager', 'engineer', 'devops', 'plan', 'advisor', 'coder', 'bookkeeper', null, 7]) {
    assert.equal(identity.isInternalRole(role), false, String(role))
  }
})

test('WHAT[participant-identity-001] legacy participant names are one closed list plus compound underscore names', () => {
  assert.deepEqual(
    [...identity.legacyNames()].sort(),
    ['browser', 'build', 'coder', 'distiller', 'executor', 'inquiry', 'inspector', 'meditator', 'student', 'teacher'],
  )
  for (const name of ['coder', 'Inspector', 'fast_engineer', 'teacher']) {
    assert.equal(identity.isLegacyName(name), true, name)
  }
  for (const name of ['engineer', 'advisor', 'bookkeeper', 'blogger', null, 3]) {
    assert.equal(identity.isLegacyName(name), false, String(name))
  }
})

test('WHAT[participant-identity-001] persona labels decode to canonical spelling only', () => {
  assert.equal(identity.tryParsePersona('Director'), 'Director')
  assert.equal(identity.tryParsePersona('DirectorV1'), 'Director')
  assert.equal(identity.tryParsePersona('Auditor'), null)
  assert.equal(identity.tryParsePersona('director'), null)
  assert.equal(identity.tryParsePersona(null), null)
})
