import test from 'node:test'
import assert from 'node:assert/strict'
import { Capability } from 'wanxiangli/capability'

const capability = new Capability()

const expected = {
  manager: ['Advisor', 'Finality', 'Fork', 'Glob', 'Grep', 'Horizon', 'Join', 'Read', 'Resume', 'ReviewAssessment'],
  orchestrator: ['Advisor', 'Fork', 'Horizon', 'Join'],
  engineer: ['Advisor', 'BashHoneypot', 'Edit', 'Fetch', 'Fission', 'Glob', 'Grep', 'Move', 'Read', 'Remove', 'Write'],
  devops: ['Advisor', 'Edit', 'Exec', 'Glob', 'Grep', 'Horizon', 'Join', 'Move', 'Read', 'Remove', 'Write'],
  plan: ['Ask', 'Deliver', 'DevOpsConsultation', 'JsPlan', 'Review'],
  advisor: [],
}

test('SPEC[capability-001] the office matrix is the single role × permission fact', () => {
  for (const [role, permissions] of Object.entries(expected)) {
    assert.deepEqual(capability.permissions(role), permissions, role)
    for (const label of capability.permissionLabels()) {
      assert.equal(capability.isAllowed(role, label), permissions.includes(label), `${role} ${label}`)
    }
  }
  assert.equal(capability.permissionLabels().length, 24)
})

test('SPEC[capability-002] roles outside the matrix fail closed', () => {
  for (const role of ['coder', 'inspector', 'browser', 'inquiry', 'distiller', 'bookkeeper', 'predictor', 'Engineer', '', null, undefined, 42]) {
    assert.deepEqual(capability.permissions(role), [], String(role))
    assert.equal(capability.isAllowed(role, 'Read'), false, String(role))
  }
  assert.equal(capability.isAllowed('engineer', 'Telepathy'), false)
  assert.equal(capability.isAllowed('engineer', 'read'), false)
  assert.equal(capability.isAllowed('engineer', null), false)
  assert.equal(capability.isAllowed('devops', 'Fission'), false, 'devops never gains Fission')
})

const facts = (overrides = {}) => ({
  hasActiveIncumbency: true, hasAssessment: false, hasConfirmation: false,
  isFinalIncumbent: false, hasCleanupBlocker: false, ...overrides,
})

test('SPEC[capability-003] the manager gate reads exact lifecycle facts', () => {
  assert.deepEqual(capability.permissionsForManagerFacts(facts()), expected.manager)
  assert.deepEqual(capability.permissionsForManagerFacts(facts({ hasActiveIncumbency: false })), [])
  // N-04: Confirmation no longer empties the tool surface; an active incumbent retains full manager capability.
  assert.deepEqual(capability.permissionsForManagerFacts(facts({ hasConfirmation: true })), expected.manager)
  assert.deepEqual(capability.permissionsForManagerFacts(facts({ hasCleanupBlocker: true, isFinalIncumbent: true, hasAssessment: true })), ['Finality', 'Join'])
  assert.deepEqual(capability.permissionsForManagerFacts(facts({ isFinalIncumbent: true, hasAssessment: true })), capability.managerFinishPermissions())
  // N-04: Granted read capability (Read/Glob/Grep) must not disappear because a review happened.
  assert.deepEqual(capability.permissionsForManagerFacts(facts({ hasAssessment: true })), expected.manager)
  assert.ok(capability.permissionsForManagerFacts(facts({ hasAssessment: true })).includes('Read'))
  assert.ok(capability.permissionsForManagerFacts(facts({ hasAssessment: true })).includes('Glob'))
  assert.ok(capability.permissionsForManagerFacts(facts({ hasAssessment: true })).includes('Grep'))
  assert.deepEqual(capability.managerFinishPermissions(), ['Finality', 'Glob', 'Grep', 'Horizon', 'Join', 'Read'])
})

test('SPEC[capability-003] malformed manager facts grant nothing', () => {
  assert.deepEqual(capability.permissionsForManagerFacts(null), [])
  assert.deepEqual(capability.permissionsForManagerFacts('active'), [])
  assert.deepEqual(capability.permissionsForManagerFacts({ hasActiveIncumbency: 'true' }), [])
  assert.deepEqual(capability.permissionsForManagerFacts({ hasActiveIncumbency: 1 }), [])
})
