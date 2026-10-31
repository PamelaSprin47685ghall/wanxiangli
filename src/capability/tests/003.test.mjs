import test from 'node:test'
import assert from 'node:assert/strict'
import { Capability } from 'wanxiangli/capability'

const capability = new Capability()
const active = ['manager', 'orchestrator', 'engineer', 'devops', 'plan']

test('SPEC[capability-005] utility tools are not office permissions', () => {
  assert.deepEqual(capability.utilityToolNames(), ['skill', 'assume'])
  for (const name of capability.utilityToolNames()) {
    for (const role of active) assert.equal(capability.permissionOfToolName(role, name) ?? null, null, `${role} ${name}`)
    for (const p of capability.permissionLabels()) assert.ok(!capability.toolNames(p).includes(name), `${p} ${name}`)
  }
})

test('SPEC[capability-005] active working roles hold utilities', () => {
  for (const role of active) for (const name of ['skill', 'assume'])
    assert.equal(capability.admitsUtility(role, name), true, `${role} ${name}`)
})

test('SPEC[capability-005] roles outside the matrix fail closed, including the retired distiller', () => {
  for (const role of ['advisor', 'distiller', 'coder', 'inspector', 'browser', 'inquiry', 'bookkeeper', 'Engineer', '', null, undefined, 7, {}])
    for (const name of ['skill', 'assume'])
      assert.equal(capability.admitsUtility(role, name), false, `${String(role)} ${name}`)
})

test('SPEC[capability-005] only utility names are admitted as utilities', () => {
  for (const role of active) for (const name of ['fork', 'deliver', 'review', 'Skill', 'assume ', '', null, 1])
    assert.equal(capability.admitsUtility(role, name), false, `${role} ${String(name)}`)
})
