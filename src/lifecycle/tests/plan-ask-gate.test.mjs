import test from 'node:test'
import assert from 'node:assert/strict'
import { PlanAskGate, planAskGate } from 'wanxiangli/work'

test('WHAT[work-028] SPEC[lifecycle-ask-001] 同一 workId 首次 tryBegin 成功，二次并发 tryBegin 被拒', () => {
  const gate = new PlanAskGate()
  assert.equal(gate.isPending('work-1'), false)
  assert.equal(gate.tryBegin('work-1'), true, '首次进入应当成功')
  assert.equal(gate.isPending('work-1'), true, '进入后应当为 pending 状态')

  // 二次重入被拒
  assert.equal(gate.tryBegin('work-1'), false, '重复进入必须被互斥拒绝')
  assert.equal(gate.isPending('work-1'), true)
})

test('WHAT[work-028] SPEC[lifecycle-ask-002] 不同 workId 互不阻塞', () => {
  const gate = new PlanAskGate()
  assert.equal(gate.tryBegin('work-a'), true)
  assert.equal(gate.tryBegin('work-b'), true, '不同 workId 应当独立准入')
  assert.equal(gate.tryBegin('work-c'), true, '不同 workId 应当独立准入')

  assert.equal(gate.isPending('work-a'), true)
  assert.equal(gate.isPending('work-b'), true)
  assert.equal(gate.isPending('work-c'), true)
  assert.equal(gate.isPending('work-d'), false)
})

test('WHAT[work-028] SPEC[lifecycle-ask-003] clear 幂等且释放后同一 workId 恢复可重入', () => {
  const gate = new PlanAskGate()
  assert.equal(gate.tryBegin('work-1'), true)
  assert.equal(gate.tryBegin('work-1'), false)

  gate.clear('work-1')
  assert.equal(gate.isPending('work-1'), false, 'clear 后应当不再 pending')

  // 重复 clear 幂等
  gate.clear('work-1')
  gate.clear('non-existent-work')
  assert.equal(gate.isPending('work-1'), false)

  // 释放后恢复可重入
  assert.equal(gate.tryBegin('work-1'), true, '释放后应当允许重新进入')
  assert.equal(gate.isPending('work-1'), true)
})

test('WHAT[work-028] SPEC[lifecycle-ask-004] clearAll 清空全部状态', () => {
  const gate = new PlanAskGate()
  gate.tryBegin('work-x')
  gate.tryBegin('work-y')
  gate.tryBegin('work-z')
  assert.deepEqual(gate.snapshot(), ['work-x', 'work-y', 'work-z'])

  gate.clearAll()
  assert.deepEqual(gate.snapshot(), [])
  assert.equal(gate.isPending('work-x'), false)
  assert.equal(gate.isPending('work-y'), false)
  assert.equal(gate.isPending('work-z'), false)

  // 清空后所有 work 均可重新进入
  assert.equal(gate.tryBegin('work-x'), true)
  assert.equal(gate.tryBegin('work-y'), true)
})

test('WHAT[work-028] SPEC[lifecycle-ask-005] snapshot 返回排序原生数组快照且外部修改不破坏内部状态', () => {
  const gate = new PlanAskGate()
  gate.tryBegin('charlie')
  gate.tryBegin('alpha')
  gate.tryBegin('bravo')

  const snap = gate.snapshot()
  assert.deepEqual(snap, ['alpha', 'bravo', 'charlie'], '快照应当保持确定性排序')

  // 外部篡改数组
  snap.push('delta')
  snap.splice(0, 1)
  assert.equal(gate.isPending('delta'), false, '外部数组修改不得影响内部 pending 状态')
  assert.equal(gate.isPending('alpha'), true, '外部数组修改不得影响内部 pending 状态')
  assert.deepEqual(gate.snapshot(), ['alpha', 'bravo', 'charlie'])
})

test('WHAT[work-028] SPEC[lifecycle-ask-006] 边界防御：非法与空白 workId 返回 false 且不塞入集合', () => {
  const gate = new PlanAskGate()
  assert.equal(gate.tryBegin(null), false)
  assert.equal(gate.tryBegin(undefined), false)
  assert.equal(gate.tryBegin(''), false)
  assert.equal(gate.tryBegin('   '), false)
  assert.equal(gate.tryBegin('\t\n'), false)

  assert.equal(gate.isPending(null), false)
  assert.equal(gate.isPending(''), false)
  assert.equal(gate.isPending('   '), false)

  gate.clear(null)
  gate.clear('')
  gate.clear('   ')

  assert.deepEqual(gate.snapshot(), [])
})

test('WHAT[work-028] SPEC[lifecycle-ask-007] 独立实例与全局单例相互隔离', () => {
  // 确保全局单例在干净状态
  planAskGate.clearAll()
  const custom = new PlanAskGate()

  assert.equal(custom.tryBegin('isolation-work'), true)
  assert.equal(planAskGate.isPending('isolation-work'), false, '单例不应感知独立实例的占用')
  assert.equal(planAskGate.tryBegin('isolation-work'), true, '单例应当可独立准入')

  custom.clearAll()
  assert.equal(custom.isPending('isolation-work'), false)
  assert.equal(planAskGate.isPending('isolation-work'), true, '独立实例 clearAll 不影响单例')

  planAskGate.clearAll()
})
