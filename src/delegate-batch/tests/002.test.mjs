import test from 'node:test'
import assert from 'node:assert/strict'

import { JoinGuardReservationStore, joinGuardReservationStore } from 'wanxiangli/delegate-batch'

test('SPEC[join-guard-1] nudgeKey 严格生成 "join-guard:<sessionId>:<terminalProviderRun>"', () => {
  assert.equal(joinGuardReservationStore.nudgeKey('ses-1', 'run-1'), 'join-guard:ses-1:run-1')
  assert.equal(joinGuardReservationStore.formatKey('  ses-alpha  ', '  run-beta  '), 'join-guard:ses-alpha:run-beta')
})

test('SPEC[join-guard-2] 首次 tryReserve 成功返回 key 并写入局部与全局集合', () => {
  const store = new JoinGuardReservationStore()
  const scope = store.createScope()

  const key = store.tryReserve(scope, 'ses-test-2', 'run-test-2')
  assert.equal(key, 'join-guard:ses-test-2:run-test-2')
  assert.equal(scope.has('join-guard:ses-test-2:run-test-2'), true)
  assert.equal(store.processCount, 1)
  assert.deepEqual(store.snapshot(), ['join-guard:ses-test-2:run-test-2'])
})

test('SPEC[join-guard-3] 同一 scope 重复 tryReserve 返回 undefined 拒绝', () => {
  const store = new JoinGuardReservationStore()
  const scope = store.createScope()

  const first = store.tryReserve(scope, 'ses-test-3', 'run-test-3')
  assert.equal(first, 'join-guard:ses-test-3:run-test-3')

  const second = store.tryReserve(scope, 'ses-test-3', 'run-test-3')
  assert.equal(second, undefined, '重复预留必须返回 undefined')
})

test('SPEC[join-guard-4] 跨不同 scope 但在同一 store 下重复 tryReserve 被全局 processKeys 拦截', () => {
  const store = new JoinGuardReservationStore()
  const scopeA = store.createScope()
  const scopeB = store.createScope()

  const first = store.tryReserve(scopeA, 'ses-test-4', 'run-test-4')
  assert.equal(first, 'join-guard:ses-test-4:run-test-4')

  const cross = store.tryReserve(scopeB, 'ses-test-4', 'run-test-4')
  assert.equal(cross, undefined, '跨 scope 重复预留必须被全局 processKeys 拦截')
  assert.equal(scopeB.has('join-guard:ses-test-4:run-test-4'), false, '被拦截的 scope 绝不写入该键')
})

test('SPEC[join-guard-5] hasOutstandingJoinClaim 为 true 或 () => true 时拒绝且不污染局部与全局集合', () => {
  const store = new JoinGuardReservationStore()
  const scope = store.createScope()

  // 1. 布尔值 true 表示有未决 claim，必须拒绝
  const res1 = store.tryReserve(scope, 'ses-claim-1', 'run-claim-1', true)
  assert.equal(res1, undefined, '布尔值 true 表示有未决 claim，必须拒绝')
  assert.equal(scope.has('join-guard:ses-claim-1:run-claim-1'), false)
  assert.equal(store.processCount, 0)

  // 2. 函数 () => true 表示有未决 claim，必须拒绝
  const res2 = store.tryReserve(scope, 'ses-claim-2', 'run-claim-2', () => true)
  assert.equal(res2, undefined, '谓词返回 true 表示有未决 claim，必须拒绝')
  assert.equal(scope.has('join-guard:ses-claim-2:run-claim-2'), false)
  assert.equal(store.processCount, 0)

  // 3. 谓词返回 false 时允许正常通过
  const res3 = store.tryReserve(scope, 'ses-claim-3', 'run-claim-3', () => false)
  assert.equal(res3, 'join-guard:ses-claim-3:run-claim-3')
  assert.equal(scope.has('join-guard:ses-claim-3:run-claim-3'), true)
  assert.equal(store.processCount, 1)
})

test('SPEC[join-guard-6] release 后同一 (sessionId, run) 可重新成功预留', () => {
  const store = new JoinGuardReservationStore()
  const scope1 = store.createScope()

  const key = store.tryReserve(scope1, 'ses-rel', 'run-rel')
  assert.equal(key, 'join-guard:ses-rel:run-rel')

  store.release(scope1, key)
  assert.equal(scope1.has(key), false)
  assert.equal(store.processCount, 0)

  // 同一 scope 可重新预留
  const reReserve1 = store.tryReserve(scope1, 'ses-rel', 'run-rel')
  assert.equal(reReserve1, key)

  store.release(scope1, key)

  // 新 scope 也可重新预留
  const scope2 = store.createScope()
  const reReserve2 = store.tryReserve(scope2, 'ses-rel', 'run-rel')
  assert.equal(reReserve2, key)
  assert.equal(scope2.has(key), true)
})

test('SPEC[join-guard-7] 不同 sessionId 或 run 互不阻塞，clearSession 仅清除目标会话', () => {
  const store = new JoinGuardReservationStore()
  const scope = store.createScope()

  assert.equal(store.tryReserve(scope, 'ses-A', 'run-1'), 'join-guard:ses-A:run-1')
  assert.equal(store.tryReserve(scope, 'ses-A', 'run-2'), 'join-guard:ses-A:run-2')
  assert.equal(store.tryReserve(scope, 'ses-B', 'run-1'), 'join-guard:ses-B:run-1')
  assert.equal(store.processCount, 3)

  store.clearSession('ses-A', scope)
  assert.equal(scope.has('join-guard:ses-A:run-1'), false)
  assert.equal(scope.has('join-guard:ses-A:run-2'), false)
  assert.equal(scope.has('join-guard:ses-B:run-1'), true, 'ses-B 必须完好保留')
  assert.equal(store.processCount, 1)

  store.clearAll()
  assert.equal(store.processCount, 0)
  assert.equal(scope.has('join-guard:ses-B:run-1'), false)
})
