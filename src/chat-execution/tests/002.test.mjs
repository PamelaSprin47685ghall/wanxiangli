import test from 'node:test'
import assert from 'node:assert/strict'

import { ChatExecutionLaw } from 'wanxiangli/chat-execution'

const law = new ChatExecutionLaw()
const plain = (v) => JSON.parse(JSON.stringify(v))
const A = { phase: 'Accepted' }, S = { phase: 'ProviderStarted' }
const B = { phase: 'EndedBeforeStart', disposition: 'Failed' }, E = { phase: 'EndedAfterStart', disposition: 'Completed' }
const recover = (over) => plain(law.recover({
  current: A, provider: 'Absent', resource: 'Held', persistence: 'NotCommitted',
  providerKeySame: true, resourceKeySame: true, providerAcceptedSame: true, providerSameAsStarted: true,
  policy: null, ...over,
}))

test('SPEC[chat-execution-3] counterexample: evidence of another execution is ignored as stale before anything else', () => {
  for (const k of ['providerKeySame', 'resourceKeySame', 'providerAcceptedSame'])
    for (const current of [A, S, B, E])
      assert.deepEqual(recover({ current, [k]: false, persistence: 'Unknown', resource: 'Unknown' }), { decision: 'ignore', reason: 'StalePhysicalEvidence' })
})

test('SPEC[chat-execution-3] an ended execution only settles its physical resource; unknown goes to a human', () => {
  for (const current of [B, E]) {
    assert.deepEqual(recover({ current }), { decision: 'releaseTerminalResource' })
    assert.deepEqual(recover({ current, resource: 'Absent' }), { decision: 'ignore', reason: 'DurableTerminalAlreadySettled' })
    assert.deepEqual(recover({ current, resource: 'Released', persistence: 'Unknown' }), { decision: 'ignore', reason: 'DurableTerminalAlreadySettled' })
    assert.deepEqual(recover({ current, resource: 'Unknown' }), { decision: 'manual', reason: 'PhysicalOutcomeUnknown' })
  }
})

test('SPEC[chat-execution-3] counterexample: an unknown persistence outcome is never settled by guess', () => {
  for (const current of [A, S]) {
    assert.deepEqual(recover({ current, persistence: 'Unknown' }), { decision: 'manual', reason: 'PersistenceOutcomeUnknown' })
    assert.deepEqual(recover({ current, persistence: 'NoNewWrite' }), { decision: 'manual', reason: 'PersistenceOutcomeUnknown' })
    assert.deepEqual(recover({ current, persistence: 'Committed' }), { decision: 'ignore', reason: 'RecoveryAlreadyCommitted' })
  }
})

test('SPEC[chat-execution-3] accepted: resume before the provider, or record what the provider already did', () => {
  assert.deepEqual(recover({ provider: 'ReceiptMissing' }), { decision: 'manual', reason: 'MissingExternalReceipt' })
  assert.deepEqual(recover({ provider: 'ReceiptAmbiguous' }), { decision: 'manual', reason: 'AmbiguousExternalReceipt' })
  assert.deepEqual(recover({ provider: 'Absent' }), { decision: 'resumePreProvider' })
  assert.deepEqual(recover({ provider: 'Alive' }), { decision: 'persistProviderStarted' })
  assert.deepEqual(recover({ provider: 'Terminal' }), { decision: 'persistProviderStartedAndTerminal' })
})

test('SPEC[chat-execution-3] started: only the same run settles; an absent provider needs an exact policy authorization', () => {
  assert.deepEqual(recover({ current: S, provider: 'Alive' }), { decision: 'ignore', reason: 'ProviderStillAlive' })
  assert.deepEqual(recover({ current: S, provider: 'Terminal' }), { decision: 'finalize', from: 'observation' })
  assert.deepEqual(recover({ current: S, provider: 'Alive', providerSameAsStarted: false }), { decision: 'ignore', reason: 'StalePhysicalEvidence' })
  assert.deepEqual(recover({ current: S, provider: 'Terminal', providerSameAsStarted: false }), { decision: 'ignore', reason: 'StalePhysicalEvidence' })
  assert.deepEqual(recover({ current: S, provider: 'ReceiptMissing' }), { decision: 'manual', reason: 'MissingExternalReceipt' })
  assert.deepEqual(recover({ current: S }), { decision: 'manual', reason: 'NoAuthorizedProviderDisposition' })
  const policy = (resolution, matches) => recover({ current: S, policy: { resolution, matches } })
  assert.deepEqual(policy('RetryFreshAttempt', true), { decision: 'ignore', reason: 'ProviderRecoveryOwned' })
  assert.deepEqual(policy('TerminalizeProviderStarted', true), { decision: 'finalize', from: 'policy' })
  assert.deepEqual(policy('RetryFreshAttempt', false), { decision: 'ignore', reason: 'StalePolicyEvidence' })
  assert.deepEqual(policy('TerminalizeProviderStarted', false), { decision: 'ignore', reason: 'StalePolicyEvidence' })
  for (const r of ['PreserveCurrentFact', 'AwaitAcceptanceReconciliation', 'TerminalizeAcceptedPreProvider'])
    for (const m of [true, false]) assert.deepEqual(policy(r, m), { decision: 'manual', reason: 'NoAuthorizedProviderDisposition' })
})

test('SPEC[chat-execution-3] malformed recovery input is refused', () => {
  assert.throws(() => law.recover(null), /recovery/)
  assert.throws(() => recover({ current: null }), /recovery.current/)
  assert.throws(() => recover({ resource: 'Gone' }), /recovery.resource/)
  assert.throws(() => recover({ providerKeySame: 'yes' }), /providerKeySame/)
  assert.throws(() => recover({ current: S, policy: { resolution: 'Other', matches: true } }), /resolution/)
  assert.throws(() => recover({ persistence: 'Maybe' }), /persistence/)
})


// --- HOST-004: SessionQuiescenceGate process-local admission gate tests ---
import { SessionQuiescenceGate, sessionQuiescenceGate } from 'wanxiangli/chat-execution'

test('SPEC[quiescence-gate-001] BeginProviderAttempt -> ObserveIdle -> TryConsume 成功', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-normal-002'

  gate.BeginProviderAttempt(session)
  const permit = gate.ObserveIdle(session)
  assert.ok(permit, 'permit must be returned')

  const res = gate.TryConsume(permit)
  assert.deepEqual(res, { ok: true, reason: null })
})

test('SPEC[quiescence-gate-002] 重复 TryConsume 报 AlreadyConsumed', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-duplicate-consume-002'

  gate.BeginProviderAttempt(session)
  const permit1 = gate.ObserveIdle(session)
  const permit2 = gate.ObserveIdle(session)
  assert.equal(permit1, permit2, 'replayed idle in same state returns identical token')

  assert.deepEqual(gate.TryConsume(permit1), { ok: true, reason: null })
  assert.deepEqual(gate.TryConsume(permit1), { ok: false, reason: 'AlreadyConsumed' })
  assert.deepEqual(gate.TryConsume(permit2), { ok: false, reason: 'AlreadyConsumed' })
})

test('SPEC[quiescence-gate-003] TryRelease 归还后可再消费', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-release-002'

  gate.BeginProviderAttempt(session)
  const permit = gate.ObserveIdle(session)

  assert.deepEqual(gate.TryRelease(permit), { ok: false, reason: 'NoFreshIdle' })
  assert.deepEqual(gate.TryConsume(permit), { ok: true, reason: null })
  assert.deepEqual(gate.TryRelease(permit), { ok: true, reason: null })
  assert.deepEqual(gate.TryConsume(permit), { ok: true, reason: null })
  assert.deepEqual(gate.TryConsume(permit), { ok: false, reason: 'AlreadyConsumed' })
})

test('SPEC[quiescence-gate-004] 未经 BeginProviderAttempt 的 ObserveIdle 不可消费 (NoFreshIdle)', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-no-attempt-002'

  const unownedIdle = gate.ObserveIdle(session)
  assert.ok(unownedIdle)

  const res = gate.TryConsume(unownedIdle)
  assert.deepEqual(res, { ok: false, reason: 'NoFreshIdle' })
})

test('SPEC[quiescence-gate-005] activeToolCounts > 0 时禁止消费 (NoFreshIdle)，EndToolExecution 恢复', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-tools-002'

  gate.BeginProviderAttempt(session)
  const permit = gate.ObserveIdle(session)

  gate.BeginToolExecution(session)
  assert.deepEqual(gate.TryConsume(permit), { ok: false, reason: 'NoFreshIdle' })

  gate.BeginToolExecution(session)
  assert.deepEqual(gate.TryConsume(permit), { ok: false, reason: 'NoFreshIdle' })

  gate.EndToolExecution(session)
  assert.deepEqual(gate.TryConsume(permit), { ok: false, reason: 'NoFreshIdle' })

  gate.EndToolExecution(session)
  assert.deepEqual(gate.TryConsume(permit), { ok: true, reason: null })
})

test('SPEC[quiescence-gate-006] 新 BeginProviderAttempt 使旧 permit 报 Superseded', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-superseded-002'

  gate.BeginProviderAttempt(session)
  const oldPermit = gate.ObserveIdle(session)

  gate.BeginProviderAttempt(session)
  const newPermit = gate.ObserveIdle(session)

  assert.deepEqual(gate.TryConsume(oldPermit), { ok: false, reason: 'Superseded' })
  assert.deepEqual(gate.TryRelease(oldPermit), { ok: false, reason: 'Superseded' })
  assert.deepEqual(gate.TryConsume(newPermit), { ok: true, reason: null })
})

test('SPEC[quiescence-gate-007] ObservePhysicalUserMessage 幂等性与新消息撤销当前 attempt (Revoked)', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-physical-msg-002'

  gate.ObservePhysicalUserMessage(session, 'msg-1')
  gate.BeginProviderAttempt(session)
  const permit = gate.ObserveIdle(session)

  gate.ObservePhysicalUserMessage(session, 'msg-1')
  assert.deepEqual(gate.TryConsume(permit), { ok: true, reason: null })

  gate.ObservePhysicalUserMessage(session, 'msg-2')
  assert.deepEqual(gate.TryRelease(permit), { ok: false, reason: 'Revoked' })

  gate.BeginProviderAttempt(session)
  const freshPermit = gate.ObserveIdle(session)
  assert.deepEqual(gate.TryConsume(freshPermit), { ok: true, reason: null })
})

test('SPEC[quiescence-gate-008] RevokeCurrentAttempt 永久撤销直到下一轮 BeginProviderAttempt', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-revoke-002'

  gate.BeginProviderAttempt(session)
  const permit = gate.ObserveIdle(session)

  gate.RevokeCurrentAttempt(session)
  assert.deepEqual(gate.TryConsume(permit), { ok: false, reason: 'Revoked' })

  const delayedIdle = gate.ObserveIdle(session)
  assert.deepEqual(gate.TryConsume(delayedIdle), { ok: false, reason: 'Revoked' })

  gate.BeginProviderAttempt(session)
  const nextPermit = gate.ObserveIdle(session)
  assert.deepEqual(gate.TryConsume(nextPermit), { ok: true, reason: null })
})

test('SPEC[quiescence-gate-009] 跨实例 WrongOwner 拒绝', () => {
  const gateA = new SessionQuiescenceGate()
  const gateB = new SessionQuiescenceGate()
  const session = 'ses-owner-002'

  gateA.BeginProviderAttempt(session)
  const permitA = gateA.ObserveIdle(session)

  assert.deepEqual(gateB.TryConsume(permitA), { ok: false, reason: 'WrongOwner' })
  assert.deepEqual(gateB.TryRelease(permitA), { ok: false, reason: 'WrongOwner' })

  assert.deepEqual(gateA.TryConsume({}), { ok: false, reason: 'WrongOwner' })
  assert.deepEqual(gateA.TryConsume(null), { ok: false, reason: 'WrongOwner' })
  assert.deepEqual(gateA.TryConsume('fake-token'), { ok: false, reason: 'WrongOwner' })

  assert.deepEqual(gateA.TryConsume(permitA), { ok: true, reason: null })
})

test('SPEC[quiescence-gate-010] DropSession 保留 serial 墓碑防止重用碰撞', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-drop-002'

  gate.BeginProviderAttempt(session)
  const permit = gate.ObserveIdle(session)

  gate.DropSession(session)
  assert.deepEqual(gate.TryConsume(permit), { ok: false, reason: 'NoFreshIdle' })

  gate.BeginProviderAttempt(session)
  assert.deepEqual(gate.TryConsume(permit), { ok: false, reason: 'Superseded' })

  const freshPermit = gate.ObserveIdle(session)
  assert.deepEqual(gate.TryConsume(freshPermit), { ok: true, reason: null })
})

test('SPEC[quiescence-gate-011] permit.toJSON() 抛错', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-json-002'

  gate.BeginProviderAttempt(session)
  const permit = gate.ObserveIdle(session)

  assert.throws(
    () => JSON.stringify(permit),
    /QuiescencePermit is process-local and cannot be serialized/
  )
  assert.throws(
    () => JSON.stringify({ wrapper: permit }),
    /QuiescencePermit is process-local and cannot be serialized/
  )
})

test('SPEC[quiescence-gate-012] LivePermitCount 资源计数正确', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-count-002'

  assert.equal(gate.LivePermitCount, 0)

  for (let i = 0; i < 10; i++) {
    gate.BeginProviderAttempt(session)
    const p1 = gate.ObserveIdle(session)
    const p2 = gate.ObserveIdle(session)
    assert.equal(gate.LivePermitCount, 1)
  }

  gate.RevokeCurrentAttempt(session)
  assert.equal(gate.LivePermitCount, 0)

  gate.BeginProviderAttempt(session)
  gate.ObserveIdle(session)
  assert.equal(gate.LivePermitCount, 1)

  gate.DropSession(session)
  assert.equal(gate.LivePermitCount, 0)
})

test('SPEC[quiescence-gate-013] CaptureCurrentAttempt 与 ObserveIdleFor 行为正确', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-observe-idle-for-002'

  gate.BeginProviderAttempt(session)
  const observation = gate.CaptureCurrentAttempt(session)
  assert.ok(observation)

  const permit = gate.ObserveIdleFor(observation)
  assert.ok(permit)
  assert.deepEqual(gate.TryConsume(permit), { ok: true, reason: null })

  gate.BeginProviderAttempt(session)
  const stalePermit = gate.ObserveIdleFor(observation)
  assert.equal(stalePermit, null)
})

test('SPEC[quiescence-gate-014] 全局单例 sessionQuiescenceGate 正常可用', () => {
  assert.ok(sessionQuiescenceGate instanceof SessionQuiescenceGate)
  const session = 'ses-singleton-002'

  sessionQuiescenceGate.BeginProviderAttempt(session)
  const permit = sessionQuiescenceGate.ObserveIdle(session)
  assert.deepEqual(sessionQuiescenceGate.TryConsume(permit), { ok: true, reason: null })
  sessionQuiescenceGate.DropSession(session)
})


test('SPEC[quiescence-gate-015] camelCase 方法名别名正常可用', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-camel-003'

  gate.observePhysicalUserMessage(session, 'msg-1')
  gate.beginProviderAttempt(session)
  gate.beginToolExecution(session)
  gate.endToolExecution(session)
  gate.observePhysicalUserMessage(session, 'msg-1')
  const permit = gate.observeIdle(session)
  const observation = gate.captureCurrentAttempt(session)
  const pFor = gate.observeIdleFor(observation)
  assert.ok(pFor)
  assert.equal(gate.livePermitCount(), 1)
  assert.deepEqual(gate.tryConsume(permit), { ok: true, reason: null })
  assert.deepEqual(gate.tryRelease(permit), { ok: true, reason: null })
  gate.revokeCurrentAttempt(session)
  gate.dropSession(session)
  assert.equal(gate.livePermitCount(), 0)
})

test('SPEC[quiescence-gate-016] 没有 provider attempt 的 idle 观察只给探针 token，不占 live permit', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-fresh-probe'

  const probe = gate.ObserveIdle(session)
  assert.ok(probe)
  assert.equal(gate.LivePermitCount, 0)
  assert.deepEqual(gate.TryConsume(probe), { ok: false, reason: 'NoFreshIdle' })
})
