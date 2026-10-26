import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SyncDelegateBatchStore,
  syncDelegateBatchStore,
  RetiredDelegateRegistry,
  retiredDelegateRegistry
} from 'wanxiangli/delegate-batch'

test('SPEC[sync-batch-1] 专属代理单飞互斥：同一代理在途调用排他，完结后方可复用', () => {
  const store = new SyncDelegateBatchStore()

  // 准入单调用
  const admitRes = store.admit('scope-1', 'engineer', 'inv-1', null)
  assert.equal(admitRes.verdict, 'single')

  // 首个呼叫成功进入
  const beginRes1 = store.beginCall('owner-1', 'scope-1', 'engineer', 'delegate-session-A', 'agent-eng', ['inv-1'], 'call-1')
  assert.deepEqual(beginRes1, { ok: true })
  assert.equal(store.activeCallsCount, 1)

  // 相同代理会话并发第二个呼叫必被拒绝（单飞互斥）
  const admitRes2 = store.admit('scope-2', 'engineer', 'inv-2', null)
  assert.equal(admitRes2.verdict, 'single')
  const beginRes2 = store.beginCall('owner-2', 'scope-2', 'engineer', 'delegate-session-A', 'agent-eng', ['inv-2'], 'call-2')
  assert.deepEqual(beginRes2, {
    ok: false,
    error: 'sync delegate rejected: dedicated delegate already has an in-flight call'
  })

  // 弹出首个呼叫后，该代理释放，可顺利接受新呼叫
  const popped = store.tryPopCallByDelegate('delegate-session-A')
  assert.equal(popped, 'call-1')
  assert.equal(store.activeCallsCount, 0)

  const beginRes3 = store.beginCall('owner-2', 'scope-2', 'engineer', 'delegate-session-A', 'agent-eng', ['inv-2'], 'call-2')
  assert.deepEqual(beginRes3, { ok: true })
  assert.equal(store.activeCallsCount, 1)
})

test('SPEC[sync-batch-2] 批次状态机演化：Pending -> Ready -> Active -> Closed', () => {
  const store = new SyncDelegateBatchStore()

  const batchDef = {
    providerRun: 'run-alpha',
    callOrder: ['call-tool-1', 'call-tool-2'],
    currentCall: 'call-tool-1'
  }

  // 第一个 tool call 到达，状态为 wait (Pending)
  const admit1 = store.admit('scope-batch', 'engineer', 'inv-part-1', batchDef)
  assert.equal(admit1.verdict, 'wait')
  assert.equal(store.batchesCount, 1)

  // 未凑齐前 beginCall 必定失败
  const earlyBegin = store.beginCall('owner-b', 'scope-batch', 'engineer', 'del-ses', 'agent-eng', ['inv-part-1'], 'c-early')
  assert.deepEqual(earlyBegin, {
    ok: false,
    error: 'sync delegate call was cancelled before dispatch'
  })

  // 第二个 tool call 到达，凑齐批次，状态变为 ready
  const batchDef2 = {
    providerRun: 'run-alpha',
    callOrder: ['call-tool-1', 'call-tool-2'],
    currentCall: 'call-tool-2'
  }
  const admit2 = store.admit('scope-batch', 'engineer', 'inv-part-2', batchDef2)
  assert.equal(admit2.verdict, 'ready')
  assert.deepEqual(admit2.invocations, ['inv-part-1', 'inv-part-2'])

  // 凑齐后 beginCall 成功，转为 Active
  const beginOk = store.beginCall('owner-b', 'scope-batch', 'engineer', 'del-ses', 'agent-eng', admit2.invocations, 'c-ready')
  assert.deepEqual(beginOk, { ok: true })

  // 释放批次槽位
  store.releaseAdmission('scope-batch', 'engineer')
  assert.equal(store.batchesCount, 0)
})

test('SPEC[sync-batch-3] 双向索引严格原子同步，空列表自动清除作用域键', () => {
  const store = new SyncDelegateBatchStore()

  store.admit('scope-idx', 'devops', 'inv-d-1', null)
  store.beginCall('owner-i', 'scope-idx', 'devops', 'del-devops', 'agent-dev', ['inv-d-1'], 'call-dev-1')

  assert.equal(store.tryPeekCallByDelegate('del-devops'), 'call-dev-1')
  assert.equal(store.tryPeekCallByDelegate('del-non-existent'), undefined)

  // tryPopExactCall 不匹配时不移除
  const mismatch = store.tryPopExactCall('del-devops', 'wrong-call-id')
  assert.equal(mismatch, undefined)
  assert.equal(store.tryPeekCallByDelegate('del-devops'), 'call-dev-1')

  // tryPopExactCall 匹配时精准移除
  const matched = store.tryPopExactCall('del-devops', 'call-dev-1')
  assert.equal(matched, 'call-dev-1')
  assert.equal(store.tryPeekCallByDelegate('del-devops'), undefined)
  assert.equal(store.activeCallsCount, 0)
})

test('SPEC[sync-batch-4] 取消级联与纯 Key 结算：原子清算目标作用域并返回纯键集合，不波及邻近作用域', () => {
  const store = new SyncDelegateBatchStore()

  // 建立 scope-X 上的在途批次与调用
  store.admit('scope-X', 'engineer', 'inv-x1', null)
  store.beginCall('owner-X', 'scope-X', 'engineer', 'del-X', 'agent-X', ['inv-x1'], 'call-X1')

  // 建立 scope-X 上的待凑批次
  store.admit('scope-X', 'devops', 'inv-x2', {
    providerRun: 'run-X',
    callOrder: ['c1', 'c2'],
    currentCall: 'c1'
  })

  // 建立对照组 scope-Y
  store.admit('scope-Y', 'engineer', 'inv-y1', null)
  store.beginCall('owner-Y', 'scope-Y', 'engineer', 'del-Y', 'agent-Y', ['inv-y1'], 'call-Y1')

  // 执行 cancelScope("scope-X")
  const settlement = store.cancelScope('scope-X')

  // 断言纯 Key 结算返回
  assert.deepEqual(settlement.cancelledCalls, ['call-X1'])
  assert.ok(settlement.cancelledInvocations.includes('inv-x2'))

  // scope-X 的调用与批次已被彻底清空
  assert.equal(store.tryPeekCallByDelegate('del-X'), undefined)

  // scope-Y 完好无损不受波及
  assert.equal(store.tryPeekCallByDelegate('del-Y'), 'call-Y1')
  assert.equal(store.activeCallsCount, 1)

  // 全量 clearAll 测试
  const allSettlement = store.clearAll()
  assert.deepEqual(allSettlement.cancelledCalls, ['call-Y1'])
  assert.equal(store.activeCallsCount, 0)
  assert.equal(store.batchesCount, 0)
})

test('SPEC[sync-batch-5] 工具调用物理观察去重 (Seen) 与显式按会话清理', () => {
  const store = new SyncDelegateBatchStore()

  // 相同 callId 多次到达，内部 Seen 去重
  store.observeProviderToolCall('owner-obs', 'run-1', 'engineer', 'tool-call-alpha')
  store.observeProviderToolCall('owner-obs', 'run-1', 'engineer', 'tool-call-alpha')
  store.observeProviderToolCall('owner-obs', 'run-1', 'engineer', 'tool-call-beta')

  const batch = store.tryObservedBatch('owner-obs', 'run-1', 'engineer', 'tool-call-alpha')
  assert.deepEqual(batch, ['tool-call-alpha', 'tool-call-beta'])

  // 显式清理该会话观察
  assert.equal(store.observedRunsCount, 1)
  store.clearSessionObserved('owner-obs')
  assert.equal(store.observedRunsCount, 0)
})

test('SPEC[retired-delegate-1] RetiredDelegateRegistry 单飞暂存、单值覆盖返回旧值与原子消费', () => {
  const registry = new RetiredDelegateRegistry()

  // 1. 首次暂存，无旧值返回
  const prev1 = registry.stage('scope-owner-1', 'child-session-101')
  assert.equal(prev1, undefined)
  assert.equal(registry.count, 1)
  assert.equal(registry.tryGet('scope-owner-1'), 'child-session-101')

  // 2. 单飞保证下同一作用域再退役新子会话，显式覆盖并返回旧 session ID 供草稿清理
  const prev2 = registry.stage('scope-owner-1', 'child-session-102')
  assert.equal(prev2, 'child-session-101', '必须返回被替换的旧会话以供草稿清理')
  assert.equal(registry.tryGet('scope-owner-1'), 'child-session-102')
  assert.equal(registry.count, 1)

  // 3. 原子 tryTake 消费
  const taken = registry.tryTake('scope-owner-1')
  assert.equal(taken, 'child-session-102')
  assert.equal(registry.tryGet('scope-owner-1'), undefined)
  assert.equal(registry.count, 0)

  // 4. 重复 tryTake 返回 undefined
  assert.equal(registry.tryTake('scope-owner-1'), undefined)

  // 5. 全局单例与隔离测试
  assert.ok(retiredDelegateRegistry instanceof RetiredDelegateRegistry)
  assert.ok(syncDelegateBatchStore instanceof SyncDelegateBatchStore)
})
