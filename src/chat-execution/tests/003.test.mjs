import test from 'node:test'
import assert from 'node:assert/strict'

import { SessionQuiescenceGate, sessionQuiescenceGate } from 'wanxiangli/chat-execution'

test('SPEC[quiescence-gate-001] BeginProviderAttempt -> ObserveIdle -> TryConsume 成功', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-normal'

  gate.BeginProviderAttempt(session)
  const permit = gate.ObserveIdle(session)
  assert.ok(permit, 'permit must be returned')

  const res = gate.TryConsume(permit)
  assert.deepEqual(res, { ok: true, reason: null })
})

test('SPEC[quiescence-gate-002] 重复 TryConsume 报 AlreadyConsumed', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-duplicate-consume'

  gate.BeginProviderAttempt(session)
  const permit1 = gate.ObserveIdle(session)
  const permit2 = gate.ObserveIdle(session)
  // Both permits have the same underlying serial and state
  assert.equal(permit1, permit2, 'replayed idle in same state returns identical token')

  assert.deepEqual(gate.TryConsume(permit1), { ok: true, reason: null })
  assert.deepEqual(gate.TryConsume(permit1), { ok: false, reason: 'AlreadyConsumed' })
  assert.deepEqual(gate.TryConsume(permit2), { ok: false, reason: 'AlreadyConsumed' })
})

test('SPEC[quiescence-gate-003] TryRelease 归还后可再消费', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-release'

  gate.BeginProviderAttempt(session)
  const permit = gate.ObserveIdle(session)

  // 未消费时释放报 NoFreshIdle
  assert.deepEqual(gate.TryRelease(permit), { ok: false, reason: 'NoFreshIdle' })

  // 正常消费
  assert.deepEqual(gate.TryConsume(permit), { ok: true, reason: null })

  // 成功归还
  assert.deepEqual(gate.TryRelease(permit), { ok: true, reason: null })

  // 归还后可再次消费
  assert.deepEqual(gate.TryConsume(permit), { ok: true, reason: null })

  // 重复消费报 AlreadyConsumed
  assert.deepEqual(gate.TryConsume(permit), { ok: false, reason: 'AlreadyConsumed' })
})

test('SPEC[quiescence-gate-004] 未经 BeginProviderAttempt 的 ObserveIdle 不可消费 (NoFreshIdle)', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-no-attempt'

  // 未开始 attempt 时的 idle observation 属于历史迟到 observation
  const unownedIdle = gate.ObserveIdle(session)
  assert.ok(unownedIdle)

  const res = gate.TryConsume(unownedIdle)
  assert.deepEqual(res, { ok: false, reason: 'NoFreshIdle' })
})

test('SPEC[quiescence-gate-005] activeToolCounts > 0 时禁止消费 (NoFreshIdle)，EndToolExecution 恢复', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-tools'

  gate.BeginProviderAttempt(session)
  const permit = gate.ObserveIdle(session)

  // 工具执行期间不能消费 idle
  gate.BeginToolExecution(session)
  assert.deepEqual(gate.TryConsume(permit), { ok: false, reason: 'NoFreshIdle' })

  // 多层嵌套工具
  gate.BeginToolExecution(session)
  assert.deepEqual(gate.TryConsume(permit), { ok: false, reason: 'NoFreshIdle' })

  gate.EndToolExecution(session)
  assert.deepEqual(gate.TryConsume(permit), { ok: false, reason: 'NoFreshIdle' })

  // 最后一层退出
  gate.EndToolExecution(session)
  assert.deepEqual(gate.TryConsume(permit), { ok: true, reason: null })
})

test('SPEC[quiescence-gate-006] 新 BeginProviderAttempt 使旧 permit 报 Superseded', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-superseded'

  gate.BeginProviderAttempt(session)
  const oldPermit = gate.ObserveIdle(session)

  // 开启新 attempt
  gate.BeginProviderAttempt(session)
  const newPermit = gate.ObserveIdle(session)

  assert.deepEqual(gate.TryConsume(oldPermit), { ok: false, reason: 'Superseded' })
  assert.deepEqual(gate.TryRelease(oldPermit), { ok: false, reason: 'Superseded' })

  // 新 permit 正常消费
  assert.deepEqual(gate.TryConsume(newPermit), { ok: true, reason: null })
})

test('SPEC[quiescence-gate-007] ObservePhysicalUserMessage 幂等性与新消息撤销当前 attempt (Revoked)', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-physical-msg'

  gate.ObservePhysicalUserMessage(session, 'msg-1')
  gate.BeginProviderAttempt(session)
  const permit = gate.ObserveIdle(session)

  // 重复观察相同物理消息幂等，不撤销当前 attempt
  gate.ObservePhysicalUserMessage(session, 'msg-1')
  assert.deepEqual(gate.TryConsume(permit), { ok: true, reason: null })

  // 产生新物理消息，撤销旧 attempt
  gate.ObservePhysicalUserMessage(session, 'msg-2')
  assert.deepEqual(gate.TryRelease(permit), { ok: false, reason: 'Revoked' })

  // 新 attempt 恢复正常
  gate.BeginProviderAttempt(session)
  const freshPermit = gate.ObserveIdle(session)
  assert.deepEqual(gate.TryConsume(freshPermit), { ok: true, reason: null })
})

test('SPEC[quiescence-gate-008] RevokeCurrentAttempt 永久撤销直到下一轮 BeginProviderAttempt', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-revoke'

  gate.BeginProviderAttempt(session)
  const permit = gate.ObserveIdle(session)

  gate.RevokeCurrentAttempt(session)
  assert.deepEqual(gate.TryConsume(permit), { ok: false, reason: 'Revoked' })

  // 迟到的 ObserveIdle 依然受 Revoked 约束不可消费
  const delayedIdle = gate.ObserveIdle(session)
  assert.deepEqual(gate.TryConsume(delayedIdle), { ok: false, reason: 'Revoked' })

  // 只有新一轮真实 BeginProviderAttempt 才能恢复
  gate.BeginProviderAttempt(session)
  const nextPermit = gate.ObserveIdle(session)
  assert.deepEqual(gate.TryConsume(nextPermit), { ok: true, reason: null })
})

test('SPEC[quiescence-gate-009] 跨实例 WrongOwner 拒绝', () => {
  const gateA = new SessionQuiescenceGate()
  const gateB = new SessionQuiescenceGate()
  const session = 'ses-owner'

  gateA.BeginProviderAttempt(session)
  const permitA = gateA.ObserveIdle(session)

  assert.deepEqual(gateB.TryConsume(permitA), { ok: false, reason: 'WrongOwner' })
  assert.deepEqual(gateB.TryRelease(permitA), { ok: false, reason: 'WrongOwner' })

  // 伪造对象也被拒绝为 WrongOwner
  assert.deepEqual(gateA.TryConsume({}), { ok: false, reason: 'WrongOwner' })
  assert.deepEqual(gateA.TryConsume(null), { ok: false, reason: 'WrongOwner' })
  assert.deepEqual(gateA.TryConsume('fake-token'), { ok: false, reason: 'WrongOwner' })

  // gateA 自身正常消费
  assert.deepEqual(gateA.TryConsume(permitA), { ok: true, reason: null })
})

test('SPEC[quiescence-gate-010] DropSession 保留 serial 墓碑防止重用碰撞', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-drop'

  gate.BeginProviderAttempt(session)
  const permit = gate.ObserveIdle(session)

  gate.DropSession(session)
  // Drop 后原 permit 报 NoFreshIdle
  assert.deepEqual(gate.TryConsume(permit), { ok: false, reason: 'NoFreshIdle' })

  // 重用相同 session id 开始新 attempt，递增后的 serial tombstone 使老 permit 报 Superseded
  gate.BeginProviderAttempt(session)
  assert.deepEqual(gate.TryConsume(permit), { ok: false, reason: 'Superseded' })

  // 新 permit 正常消费
  const freshPermit = gate.ObserveIdle(session)
  assert.deepEqual(gate.TryConsume(freshPermit), { ok: true, reason: null })
})

test('SPEC[quiescence-gate-011] permit.toJSON() 抛错', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-json'

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
  const session = 'ses-count'

  assert.equal(gate.LivePermitCount, 0)

  // 经历 10 次 attempt 轮换，LivePermitCount 不超过 1
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
  const session = 'ses-observe-idle-for'

  gate.BeginProviderAttempt(session)
  const observation = gate.CaptureCurrentAttempt(session)
  assert.ok(observation)

  // 相同 attempt 下 ObserveIdleFor 成功转换并得到可消费 permit
  const permit = gate.ObserveIdleFor(observation)
  assert.ok(permit)
  assert.deepEqual(gate.TryConsume(permit), { ok: true, reason: null })

  // 新 attempt 后，旧 observation 无法 ObserveIdleFor (返回 null)
  gate.BeginProviderAttempt(session)
  const stalePermit = gate.ObserveIdleFor(observation)
  assert.equal(stalePermit, null)
})

test('SPEC[quiescence-gate-014] 全局单例 sessionQuiescenceGate 正常可用', () => {
  assert.ok(sessionQuiescenceGate instanceof SessionQuiescenceGate)
  const session = 'ses-singleton'

  sessionQuiescenceGate.BeginProviderAttempt(session)
  const permit = sessionQuiescenceGate.ObserveIdle(session)
  assert.deepEqual(sessionQuiescenceGate.TryConsume(permit), { ok: true, reason: null })
  sessionQuiescenceGate.DropSession(session)
})

test('SPEC[quiescence-gate-015] camelCase 方法名别名正常可用', () => {
  const gate = new SessionQuiescenceGate()
  const session = 'ses-camel'

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
