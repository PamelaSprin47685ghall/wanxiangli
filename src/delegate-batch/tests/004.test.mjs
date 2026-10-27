import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DeferredInspectionStore,
  deferredInspectionStore
} from 'wanxiangli/delegate-batch'

test('SPEC[deferred-inspection-1] stage: 会话级 FIFO 挂起排队，记录完整字段，计数单调推进', () => {
  const store = new DeferredInspectionStore()

  assert.equal(store.hasPending('session-1'), false)
  assert.equal(store.pendingCount('session-1'), 0)
  assert.equal(store.totalPendingCallsCount, 0)
  assert.equal(store.pendingSessionsCount, 0)

  const res1 = store.stage('session-1', 'call-1', 'check logs', 'logs, errors', 2)
  assert.deepEqual(res1, { ok: true, stagedCount: 1, callId: 'call-1', reason: null })
  assert.equal(store.hasPending('session-1'), true)
  assert.equal(store.pendingCount('session-1'), 1)
  assert.equal(store.totalPendingCallsCount, 1)
  assert.equal(store.pendingSessionsCount, 1)

  const res2 = store.stage('session-1', 'call-2', 'inspect db', 'db, timeout', null)
  assert.deepEqual(res2, { ok: true, stagedCount: 2, callId: 'call-2', reason: null })
  assert.equal(store.pendingCount('session-1'), 2)
  assert.equal(store.totalPendingCallsCount, 2)
  assert.equal(store.pendingSessionsCount, 1)
})

test('SPEC[deferred-inspection-2] 防重复：同一 callId 严禁重复入队，必须返回 DuplicateCall 拒绝', () => {
  const store = new DeferredInspectionStore()

  const res1 = store.stage('session-1', 'call-dup', 'charge 1', '', null)
  assert.equal(res1.ok, true)

  // 相同会话再次 stage 相同 callId
  const resDupSame = store.stage('session-1', 'call-dup', 'charge 1 duplicate', '', null)
  assert.equal(resDupSame.ok, false)
  assert.equal(resDupSame.reason, 'DuplicateCall')
  assert.equal(resDupSame.existingSession, 'session-1')

  // 跨会话再次 stage 相同 callId 也必须被拒绝
  const resDupOther = store.stage('session-2', 'call-dup', 'charge from other session', '', null)
  assert.equal(resDupOther.ok, false)
  assert.equal(resDupOther.reason, 'DuplicateCall')
  assert.equal(resDupOther.existingSession, 'session-1')
  assert.equal(store.totalPendingCallsCount, 1)
})

test('SPEC[deferred-inspection-3] 输入边界校验：空 sessionId / callId / charge 必须被安全拒绝', () => {
  const store = new DeferredInspectionStore()

  assert.equal(store.stage('', 'call-1', 'charge', '', null).ok, false)
  assert.equal(store.stage('   ', 'call-1', 'charge', '', null).ok, false)
  assert.equal(store.stage('session-1', '', 'charge', '', null).ok, false)
  assert.equal(store.stage('session-1', '   ', 'charge', '', null).ok, false)
  assert.equal(store.stage('session-1', 'call-1', '', '', null).ok, false)
  assert.equal(store.totalPendingCallsCount, 0)
})

test('SPEC[deferred-inspection-4] takePending 原子消费：弹出全部挂起项并排空，后继取出为空数组', () => {
  const store = new DeferredInspectionStore()

  store.stage('session-A', 'call-A1', 'charge A1', 'kw1', 1)
  store.stage('session-A', 'call-A2', 'charge A2', 'kw2', 2)

  assert.equal(store.pendingCount('session-A'), 2)

  const items = store.takePending('session-A')
  assert.equal(items.length, 2)
  assert.equal(items[0].callId, 'call-A1')
  assert.equal(items[0].charge, 'charge A1')
  assert.equal(items[0].keywords, 'kw1')
  assert.equal(items[0].estimate, 1)
  assert.equal(items[1].callId, 'call-A2')
  assert.equal(items[1].charge, 'charge A2')

  // 排空后再次取应原子返回空数组
  assert.equal(store.hasPending('session-A'), false)
  assert.equal(store.pendingCount('session-A'), 0)
  assert.deepEqual(store.takePending('session-A'), [])

  // 消费完成后该 callId 允许再次入队
  const reStaged = store.stage('session-A', 'call-A1', 'charge A1 fresh', '', null)
  assert.equal(reStaged.ok, true)
})

test('SPEC[deferred-inspection-5] 替换结果存储与查询：recordReplacedResult 与 tryReplacedResult 精确对应', () => {
  const store = new DeferredInspectionStore()

  assert.equal(store.hasReplacedResults(), false)
  assert.equal(store.replacedResultsCount, 0)
  assert.equal(store.tryReplacedResult('call-unknown'), undefined)

  store.recordReplacedResult('call-101', 'Replacement text for 101')
  assert.equal(store.hasReplacedResults(), true)
  assert.equal(store.replacedResultsCount, 1)
  assert.equal(store.tryReplacedResult('call-101'), 'Replacement text for 101')

  // 批量记录
  store.recordReplacedResults([
    ['call-102', 'Result 102'],
    ['call-103', 'Result 103']
  ])
  assert.equal(store.replacedResultsCount, 3)
  assert.equal(store.tryReplacedResult('call-102'), 'Result 102')
  assert.equal(store.tryReplacedResult('call-103'), 'Result 103')
})

test('SPEC[deferred-inspection-6] clearSession 会话隔离清理：只清理目标会话挂起与替换，不波及邻居会话', () => {
  const store = new DeferredInspectionStore()

  store.stage('session-X', 'call-X1', 'charge X1', '', null)
  store.stage('session-Y', 'call-Y1', 'charge Y1', '', null)

  store.recordReplacedResult('call-X1', 'Output X1', 'session-X')
  store.recordReplacedResult('call-Y1', 'Output Y1', 'session-Y')

  assert.equal(store.pendingCount('session-X'), 1)
  assert.equal(store.pendingCount('session-Y'), 1)
  assert.equal(store.replacedResultsCount, 2)

  // 清理 session-X
  const verdictX = store.clearSession('session-X')
  assert.deepEqual(verdictX, { droppedPending: 1, droppedReplaced: 1 })

  // session-X 彻底排空
  assert.equal(store.hasPending('session-X'), false)
  assert.equal(store.tryReplacedResult('call-X1'), undefined)

  // session-Y 完全不受影响
  assert.equal(store.hasPending('session-Y'), true)
  assert.equal(store.pendingCount('session-Y'), 1)
  assert.equal(store.tryReplacedResult('call-Y1'), 'Output Y1')
})

test('SPEC[deferred-inspection-7] clearReplacedResults 与 clearAll 完整排空', () => {
  const store = new DeferredInspectionStore()

  store.stage('session-1', 'c1', 'charge 1', '', null)
  store.recordReplacedResult('c1', 'result 1')

  // 仅清理替换结果
  const droppedRep = store.clearReplacedResults()
  assert.equal(droppedRep, 1)
  assert.equal(store.hasReplacedResults(), false)
  assert.equal(store.hasPending('session-1'), true)

  // clearAll 清理一切
  store.recordReplacedResult('c2', 'result 2')
  const allVerdict = store.clearAll()
  assert.deepEqual(allVerdict, {
    droppedSessions: 1,
    droppedPendingCalls: 1,
    droppedReplacedResults: 1
  })
  assert.equal(store.totalPendingCallsCount, 0)
  assert.equal(store.replacedResultsCount, 0)
  assert.equal(store.hasReplacedResults(), false)
})

test('SPEC[deferred-inspection-8] 全局单例与多实例隔离', () => {
  const localStore = new DeferredInspectionStore()

  deferredInspectionStore.clearAll()
  assert.equal(deferredInspectionStore.totalPendingCallsCount, 0)

  localStore.stage('local-sess', 'local-call', 'local charge', '', null)
  assert.equal(localStore.totalPendingCallsCount, 1)
  assert.equal(deferredInspectionStore.totalPendingCallsCount, 0)

  deferredInspectionStore.stage('global-sess', 'global-call', 'global charge', '', null)
  assert.equal(deferredInspectionStore.totalPendingCallsCount, 1)
  assert.equal(localStore.totalPendingCallsCount, 1)

  deferredInspectionStore.clearAll()
  assert.equal(deferredInspectionStore.totalPendingCallsCount, 0)
  assert.equal(localStore.totalPendingCallsCount, 1)
})
