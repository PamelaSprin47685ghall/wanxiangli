import test from 'node:test'
import assert from 'node:assert/strict'

import { RecoveryAttemptPlanStore, recoveryAttemptPlanStore } from 'wanxiangli/failure'

test('SPEC[recovery-store-001] Pending 准入、幂等重放、冲突与身份不匹配', () => {
  const store = new RecoveryAttemptPlanStore()
  const planA = { id: 'plan-A', content: 'test-A' }
  const planB = { id: 'plan-B', content: 'test-B' }

  // 身份不匹配：期望 session 与 planSessionId 不符
  const mismatch1 = store.FreezePending('ses-1', 'phys-1', 'ses-mismatch', 'phys-1', planA)
  assert.equal(mismatch1.kind, 'IdentityMismatch')
  assert.equal(mismatch1.expectedSession, 'ses-1')
  assert.equal(mismatch1.expectedPhysical, 'phys-1')
  assert.equal(mismatch1.attempted, planA)

  // 身份不匹配：期望 physical 与 planPhysical 不符
  const mismatch2 = store.FreezePending('ses-1', 'phys-1', 'ses-1', 'phys-other', planA)
  assert.equal(mismatch2.kind, 'IdentityMismatch')

  // 首次准入成功
  const admitted = store.FreezePending('ses-1', 'phys-1', 'ses-1', 'phys-1', planA, (a, b) => a.id === b.id)
  assert.equal(admitted.kind, 'Admitted')
  assert.equal(admitted.plan, planA)

  // 幂等重放相同 plan
  const replayed = store.FreezePending('ses-1', 'phys-1', 'ses-1', 'phys-1', { id: 'plan-A', content: 'test-A' }, (a, b) => a.id === b.id)
  assert.equal(replayed.kind, 'ReplayedExisting')
  assert.equal(replayed.existing, planA)

  // 冲突不同 plan
  const conflict = store.FreezePending('ses-1', 'phys-1', 'ses-1', 'phys-1', planB, (a, b) => a.id === b.id)
  assert.equal(conflict.kind, 'PlanConflict')
  assert.equal(conflict.existing, planA)
  assert.equal(conflict.attempted, planB)

  // TryPending 查询
  assert.equal(store.TryPending('ses-1', 'phys-1'), planA)
  assert.equal(store.TryPending('ses-1', 'phys-nonexistent'), null)
})

test('SPEC[recovery-store-002] TryBind 绑定与跨 physical 改绑抛错', () => {
  const store = new RecoveryAttemptPlanStore()
  const pendingPlan = { id: 'pending-1', physicalId: 'phys-1' }

  // 无 pending 计划时 TryBindAttemptPlan 返回 null
  const unbound = store.TryBindAttemptPlan('ses-1', 'phys-1', 'run-1', (p) => ({ boundFrom: p }))
  assert.equal(unbound, null)

  // 存入 pending 计划
  store.FreezePending('ses-1', 'phys-1', 'ses-1', 'phys-1', pendingPlan)

  // 成功绑定
  const bound = store.TryBindAttemptPlan('ses-1', 'phys-1', 'run-1', (p) => ({
    boundPlanId: 'bound-1',
    source: p
  }))
  assert.notEqual(bound, null)
  assert.equal(bound.boundPlanId, 'bound-1')
  assert.equal(bound.source, pendingPlan)

  // 重复观察相同 run 与 physical：幂等返回已有 bound plan
  const reObserved = store.TryBindAttemptPlan('ses-1', 'phys-1', 'run-1', () => assert.fail('bindFn should not be called'))
  assert.equal(reObserved, bound)

  // 已绑定同一 run 但 physical 不同的观察：TryBindAttemptPlan 返回 null（无法绑定）
  const differentPhys = store.TryBindAttemptPlan('ses-1', 'phys-different', 'run-1', () => ({ boundPlanId: 'wrong' }))
  assert.equal(differentPhys, null)

  // 直接调用 BindProviderRun 跨 physical 改绑必须抛错且包含 HOST-BOUNDARY-008
  assert.throws(
    () => store.BindProviderRun('ses-1', 'run-1', 'phys-different', { illegal: true }),
    /HOST-BOUNDARY-008: cannot re-bind provider run run-1 to different physical user message phys-different/
  )

  // TryAttemptPlan 读取
  assert.equal(store.TryAttemptPlan('ses-1', 'run-1'), bound)
  assert.equal(store.TryAttemptPlan('ses-1', 'run-nonexistent'), null)
})

test('SPEC[recovery-store-003] ConsumeAttemptPlan 单次消费同时原子移除 pending 与 bound', () => {
  const store = new RecoveryAttemptPlanStore()
  const pendingPlan = { id: 'pending-consume', data: 42 }

  store.FreezePending('ses-1', 'phys-1', 'ses-1', 'phys-1', pendingPlan)
  const boundPlan = store.TryBindAttemptPlan('ses-1', 'phys-1', 'run-1', (p) => ({ boundId: 'b-1', p }))
  assert.ok(boundPlan)

  assert.equal(store.TryPending('ses-1', 'phys-1'), pendingPlan)
  assert.equal(store.TryAttemptPlan('ses-1', 'run-1'), boundPlan)

  // 单次消费
  const consumed = store.ConsumeAttemptPlan('ses-1', 'run-1')
  assert.equal(consumed, boundPlan)

  // 消费后 bound 字典被清理
  assert.equal(store.TryAttemptPlan('ses-1', 'run-1'), null)

  // 消费后 pending 字典同时被原子清理
  assert.equal(store.TryPending('ses-1', 'phys-1'), null)

  // 再次消费返回 null
  const secondConsume = store.ConsumeAttemptPlan('ses-1', 'run-1')
  assert.equal(secondConsume, null)
})

test('SPEC[recovery-store-004] ManualIntervention 登记、查询、撤销与按 session 清理', () => {
  const store = new RecoveryAttemptPlanStore()
  const req1 = { id: 'req-1', session: 'ses-1' }
  const req2 = { id: 'req-2', session: 'ses-1' }
  const req3 = { id: 'req-3', session: 'ses-2' }

  store.PublishManualIntervention('ses-1', 'phys-1', req1)
  store.PublishManualIntervention('ses-1', 'phys-2', req2)
  store.PublishManualIntervention('ses-2', 'phys-1', req3)

  const all = store.ManualInterventions()
  assert.equal(all.length, 3)
  assert.ok(all.includes(req1))
  assert.ok(all.includes(req2))
  assert.ok(all.includes(req3))

  // 撤销特定干预
  store.RevokeManualIntervention('ses-1', 'phys-1')
  const afterRevoke = store.ManualInterventions()
  assert.equal(afterRevoke.length, 2)
  assert.ok(!afterRevoke.includes(req1))
  assert.ok(afterRevoke.includes(req2))
  assert.ok(afterRevoke.includes(req3))

  // ClearSession 清理指定 session
  store.ClearSession('ses-1')
  const afterClear = store.ManualInterventions()
  assert.equal(afterClear.length, 1)
  assert.equal(afterClear[0], req3)
})

test('SPEC[recovery-store-005] ClearAttemptPlansFor 与 ClearSession 前缀隔离', () => {
  const store = new RecoveryAttemptPlanStore()

  // 构造 ses-1, ses-10, ses-2 的 plans
  store.FreezePending('ses-1', 'phys-1', 'ses-1', 'phys-1', { id: 'p1' })
  store.FreezePending('ses-10', 'phys-1', 'ses-10', 'phys-1', { id: 'p10' })
  store.FreezePending('ses-2', 'phys-1', 'ses-2', 'phys-1', { id: 'p2' })

  store.BindProviderRun('ses-1', 'run-1', 'phys-1', { id: 'b1' })
  store.BindProviderRun('ses-10', 'run-10', 'phys-1', { id: 'b10' })
  store.BindProviderRun('ses-2', 'run-2', 'phys-1', { id: 'b2' })

  // 清除 ses-1：必须使用 "\u001f" 分隔符，严禁误伤 ses-10
  store.ClearAttemptPlansFor('ses-1')

  assert.equal(store.TryPending('ses-1', 'phys-1'), null)
  assert.equal(store.TryAttemptPlan('ses-1', 'run-1'), null)

  // ses-10 必须完整保留
  assert.notEqual(store.TryPending('ses-10', 'phys-1'), null)
  assert.notEqual(store.TryAttemptPlan('ses-10', 'run-10'), null)

  // ses-2 必须完整保留
  assert.notEqual(store.TryPending('ses-2', 'phys-1'), null)
  assert.notEqual(store.TryAttemptPlan('ses-2', 'run-2'), null)
})

test('SPEC[recovery-store-006] 全局单例 recoveryAttemptPlanStore 可用性与独立实例隔离', () => {
  const instance1 = new RecoveryAttemptPlanStore()
  const instance2 = new RecoveryAttemptPlanStore()

  instance1.FreezePending('s', 'p', 's', 'p', { plan: 'inst1' })
  assert.notEqual(instance1.TryPending('s', 'p'), null)
  assert.equal(instance2.TryPending('s', 'p'), null)
  assert.equal(recoveryAttemptPlanStore.TryPending('s', 'p'), null)
})
