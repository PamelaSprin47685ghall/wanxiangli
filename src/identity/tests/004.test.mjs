import test from 'node:test'
import assert from 'node:assert/strict'
import { Identity } from 'wanxiangli/identity'

const identity = new Identity()

function bindInput(overrides = {}) {
  const evidence = identity.resolveAtRoot('engineer').evidence
  return {
    sessionId: 'session-1',
    physicalUserMessageId: 'msg-1',
    role: 'engineer',
    evidence,
    modelTarget: 'glm-5.3-oc',
    capacityFence: 'fence-1',
    ...overrides
  }
}

test('WHAT[participant-identity-004] binding requires every field and an active role', () => {
  const bound = identity.bindExecution(bindInput())
  assert.equal(bound.ok, true)
  assert.equal(bound.binding.sessionId, 'session-1')
  assert.equal(bound.binding.modelTarget, 'glm-5.3-oc')
  assert.deepEqual(bound.binding.evidence, identity.resolveAtRoot('engineer').evidence)

  for (const key of ['sessionId', 'physicalUserMessageId', 'role', 'evidence', 'modelTarget', 'capacityFence']) {
    const input = bindInput()
    delete input[key]
    assert.equal(identity.bindExecution(input).error, 'MissingBindingField', `${key} is required`)
  }
  assert.equal(identity.bindExecution(null).error, 'MissingBindingField')
  assert.deepEqual(
    identity.bindExecution(bindInput({ role: 'coder' })),
    { error: 'RoleNotActive', detail: 'coder' }
  )
  assert.equal(identity.bindExecution(bindInput({ role: 'predictor' })).error, 'RoleNotActive')
})

test('WHAT[participant-identity-004] binding rejects evidence whose role disagrees with the binding role', () => {
  const managerEvidence = identity.resolveAtRoot('manager').evidence
  assert.equal(identity.bindExecution(bindInput({ evidence: managerEvidence })).error, 'RoleMismatch')
  const tampered = { ...identity.resolveAtRoot('engineer').evidence, persona: 'Lead' }
  assert.equal(identity.bindExecution(bindInput({ evidence: tampered })).error, 'PersonaMismatch')
})

test('WHAT[participant-identity-004] model rebind changes only the physical target, never the identity', () => {
  const first = identity.bindExecution(bindInput())
  const rebound = identity.rebindTarget(first.binding, { modelTarget: 'glm-5.3-mini', capacityFence: 'fence-2' })
  assert.equal(rebound.ok, true)
  assert.equal(rebound.binding.modelTarget, 'glm-5.3-mini')
  assert.equal(rebound.binding.capacityFence, 'fence-2')
  assert.equal(rebound.binding.sessionId, first.binding.sessionId)
  assert.equal(rebound.binding.physicalUserMessageId, first.binding.physicalUserMessageId)
  assert.deepEqual(rebound.binding.evidence, first.binding.evidence)
  assert.notEqual(rebound.binding.modelTarget, first.binding.modelTarget)
})

test('WHAT[participant-identity-004] tampered binding views are rejected at rebind (fail-closed)', () => {
  const bound = identity.bindExecution(bindInput())
  const impersonated = {
    ...bound.binding,
    evidence: identity.resolveAtRoot('manager').evidence
  }
  assert.equal(identity.rebindTarget(impersonated, { modelTarget: 'glm-5.3-mini', capacityFence: 'fence-2' }).error, 'RoleMismatch')

  const renamed = { ...bound.binding, sessionId: 'session-2' }
  const renamedResult = identity.rebindTarget(renamed, { modelTarget: 'glm-5.3-mini', capacityFence: 'fence-2' })
  assert.equal(renamedResult.ok, true)
  assert.equal(renamedResult.binding.sessionId, 'session-2')

  assert.equal(identity.rebindTarget(bound.binding, { modelTarget: '', capacityFence: 'fence-2' }).error, 'MissingBindingField')
  assert.equal(identity.rebindTarget(null, { modelTarget: 'x', capacityFence: 'y' }).error, 'MissingBindingField')
})
