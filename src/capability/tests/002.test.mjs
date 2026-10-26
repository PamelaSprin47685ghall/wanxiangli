import test from 'node:test'
import assert from 'node:assert/strict'
import { Capability } from 'wanxiangli/capability'

const capability = new Capability()
const roles = ['manager', 'orchestrator', 'engineer', 'devops', 'plan', 'advisor']
const names = ['fork', 'resume', 'join', 'horizon', 'fission', 'bash-honeypot', 'review', 'fetch', 'deliver', 'todowrite-for-plan']

test('SPEC[capability-004] one permission → tool-name map; programming-surface duties have no host name', () => {
  assert.deepEqual(capability.toolNames('Fork'), ['fork'])
  assert.deepEqual(capability.toolNames('Finality'), [])
  assert.deepEqual(capability.toolNames('Deliver'), [])
  assert.deepEqual(capability.toolNames('ReviewAssessment'), ['review'])
  assert.deepEqual(capability.toolNames('Review'), ['review'])
  for (const p of ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Move', 'Remove', 'Exec', 'Pty', 'Ask', 'DevOpsConsultation', 'Advisor'])
    assert.deepEqual(capability.toolNames(p), [], p)
  assert.deepEqual(capability.toolNames('Telepathy'), [])
  assert.deepEqual(capability.toolNames(null), [])
})

test('SPEC[capability-004] a shared verb resolves to the permission the role owns', () => {
  assert.equal(capability.permissionOfToolName('manager', 'review'), 'ReviewAssessment')
  assert.equal(capability.permissionOfToolName('plan', 'review'), 'Review')
  assert.equal(capability.permissionOfToolName('manager', 'deliver') ?? null, null)
  assert.equal(capability.permissionOfToolName('plan', 'deliver') ?? null, null)
  assert.equal(capability.permissionOfToolName('engineer', 'review') ?? null, null, 'shared verb, owner of neither: undecided')
  assert.equal(capability.permissionOfToolName('engineer', 'fork'), 'Fork', 'sole owner keeps its mapping for every role')
  assert.equal(capability.permissionOfToolName('engineer', 'skill') ?? null, null)
  assert.equal(capability.permissionOfToolName('engineer', null) ?? null, null)
})

test('SPEC[capability-004] visible equals callable: admission reads the same map and matrix', () => {
  for (const role of roles) for (const name of names) {
    const permission = capability.permissionOfToolName(role, name)
    assert.equal(capability.admitsToolForRole(role, name), permission != null && capability.isAllowed(role, permission), `${role} ${name}`)
  }
  for (const role of ['coder', 'Engineer', '', null]) for (const name of names)
    assert.equal(capability.admitsToolForRole(role, name), false, `${role} ${name}`)
  assert.equal(capability.admitsToolForRole('engineer', 'bash-honeypot'), true)
  assert.equal(capability.admitsToolForRole('devops', 'bash-honeypot'), false)
})
