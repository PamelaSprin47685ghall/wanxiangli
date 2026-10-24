import test from 'node:test'
import assert from 'node:assert/strict'
import { ProgramCatalog } from './support.mjs'

const law = ProgramCatalog()

test('SPEC[program-001] Edit alone does not project a surface (base-red vs old hasFs)', () => {
  assert.equal(law.projectPermission('Edit'), null)
  assert.deepEqual(law.projectPermissions(['Edit']), [])
  assert.equal(law.admitsSurface(['Edit']), false)
})

test('SPEC[program-001] Exec alone projects call', () => {
  assert.equal(law.projectPermission('Exec'), 'Exec')
  assert.deepEqual(law.projectPermissions(['Exec']), ['Exec'])
  assert.equal(law.admitsSurface(['Exec']), true)
  assert.deepEqual(law.membersFor(['Exec'], 'DevOps'), ['call', 'signal', 'send'])
})

test('SPEC[program-001] JsPlan expands to Read/Write/Ask', () => {
  assert.deepEqual(law.projectPermissions(['JsPlan']), ['Ask', 'Read', 'Write'])
  const surface = law.projectRole('Plan', ['JsPlan'])
  assert.equal(surface.toolName, 'todowrite-for-plan')
  assert.ok(surface.members.includes('ask'))
  assert.ok(surface.members.includes('write'))
  assert.ok(surface.members.includes('cat'))
})

test('SPEC[program-001] Orchestrator Fork becomes Commission on the member surface', () => {
  const surface = law.projectRole('Orchestrator', ['Fork', 'Join', 'Horizon', 'Advisor'])
  assert.ok(surface.capabilities.includes('Commission'))
  assert.ok(!surface.capabilities.includes('Fork'))
  assert.ok(surface.members.includes('commission'))
  assert.ok(!surface.members.includes('fork'))
})

test('SPEC[program-001] Manager read members hang under reviewOnly', () => {
  const surface = law.projectRole('Manager', ['Read', 'Glob', 'Grep', 'Fork', 'Join', 'Horizon', 'Advisor', 'Resume'])
  assert.ok(surface.members.includes('reviewOnly.cat'))
  assert.ok(surface.members.includes('reviewOnly.ls'))
  assert.ok(!surface.members.includes('cat'))
})

test('SPEC[program-001] Join remains outside the programming surface', () => {
  assert.deepEqual(law.membersFor(['Fork'], 'Engineer'), ['fork'])
  assert.deepEqual(law.membersFor(['Fork', 'Join'], 'Engineer').sort(), ['fork'])
  assert.equal(law.projectPermission('Join'), null)
})

test('SPEC[program-001] ReviewAssessment and Review project to Review capability and review member', () => {
  assert.equal(law.projectPermission('ReviewAssessment'), 'Review')
  assert.equal(law.projectPermission('Review'), 'Review')
  assert.deepEqual(law.projectPermissions(['ReviewAssessment', 'Review']), ['Review'])
  assert.deepEqual(law.membersFor(['Review'], 'Manager'), ['review'])
  assert.deepEqual(law.membersFor(['Review'], 'Plan'), ['review'])
  const managerSurface = law.projectRole('Manager', ['ReviewAssessment'])
  assert.ok(managerSurface.members.includes('review'))
  assert.ok(managerSurface.capabilities.includes('Review'))
})

test('SPEC[program-001] empty / unknown labels fail closed', () => {
  assert.equal(law.admitsSurface([]), false)
  assert.equal(law.admitsSurface(['Pty', 'Deliver', 'Finality']), false)
  assert.equal(law.projectRole('Advisor', []), null)
})
