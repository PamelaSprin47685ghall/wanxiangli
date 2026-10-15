import test from 'node:test'
import assert from 'node:assert/strict'
import { Identity } from 'wanxiangli/identity'

const identity = new Identity()

test('WHAT[participant-identity-003] human-root requires an explicit participant proof', () => {
  const verified = identity.classifyOrigin({ kind: 'human-root', participant: 'manager' })
  assert.deepEqual(verified, {
    ok: true,
    origin: { kind: 'human-root', participant: 'manager' }
  })
  const missing = identity.classifyOrigin({ kind: 'human-root' })
  assert.equal(missing.error, 'UnknownPromptOrigin')
  assert.match(missing.reason, /participant/)

  // D-01 核心断言：缺失来源的失败结果里不存在任何 human 回退字段。
  assert.equal('participant' in missing, false)
})

test('WHAT[participant-identity-003] agent-owner-root requires owner and child proof', () => {
  const verified = identity.classifyOrigin({
    kind: 'agent-owner-root',
    ownerLogicalRun: 'run-1',
    childLogicalRun: 'run-2',
    childParticipant: 'engineer'
  })
  assert.deepEqual(verified, {
    ok: true,
    origin: {
      kind: 'agent-owner-root',
      ownerLogicalRun: 'run-1',
      childLogicalRun: 'run-2',
      childParticipant: 'engineer'
    }
  })
  for (const key of ['ownerLogicalRun', 'childLogicalRun', 'childParticipant']) {
    const input = {
      kind: 'agent-owner-root',
      ownerLogicalRun: 'run-1',
      childLogicalRun: 'run-2',
      childParticipant: 'engineer'
    }
    delete input[key]
    const rejected = identity.classifyOrigin(input)
    assert.equal(rejected.error, 'UnknownPromptOrigin')
    assert.match(rejected.reason, new RegExp(key))
  }
})

test('WHAT[participant-identity-003] continuation accepts only the closed vocabulary', () => {
  const verified = identity.classifyOrigin({ kind: 'continuation', continuationKind: 'ProviderRetryAttempt' })
  assert.deepEqual(verified, { ok: true, origin: { kind: 'continuation', continuationKind: 'ProviderRetryAttempt' } })
  const unknownKind = identity.classifyOrigin({ kind: 'continuation', continuationKind: 'NotAKnownKind' })
  assert.equal(unknownKind.error, 'UnknownPromptOrigin')
  assert.match(unknownKind.reason, /NotAKnownKind/)
  const missingKind = identity.classifyOrigin({ kind: 'continuation' })
  assert.equal(missingKind.error, 'UnknownPromptOrigin')
})

test('WHAT[participant-identity-003] host-internal is the only proof-free origin', () => {
  const verified = identity.classifyOrigin({ kind: 'host-internal' })
  assert.deepEqual(verified, { ok: true, origin: { kind: 'host-internal' } })
})

test('WHAT[participant-identity-003] malformed raw input is rejected without any fallback', () => {
  const rejected = [
    null,
    undefined,
    'human-root',
    42,
    {},
    { kind: null },
    { kind: 42 },
    { kind: '' },
    { kind: 'human-root', participant: 42 },
    { kind: 'weird-kind' }
  ]
  for (const raw of rejected) {
    const result = identity.classifyOrigin(raw)
    assert.equal(result.error, 'UnknownPromptOrigin', `input ${JSON.stringify(raw)} must be rejected`)
  }
})

test('WHAT[participant-identity-003] no rejection path ever yields a human origin (D-01)', () => {
  const hostile = [
    null,
    {},
    { kind: 'human-root' },
    { kind: 'human-root', participant: null },
    { kind: 'mystery' }
  ]
  for (const raw of hostile) {
    const result = identity.classifyOrigin(raw)
    assert.equal(result.ok, undefined)
    assert.equal(result.error, 'UnknownPromptOrigin')
    assert.equal(result.origin, undefined)
  }
})
