import test from 'node:test'
import assert from 'node:assert/strict'

import { PendingRunStore } from 'wanxiangli/handle-lifecycle'

// 回归：PendingRunStore 状态收敛（Phase 冗余字段删除，仅保留 Finished 单一布尔）。
// 锁定完结判定的全部对外读取路径与重注册后的完结重置；行为与收敛前一致。

test('REG[pending-run-store-settled-1] attachSubscription accepts fresh records and rejects settled ones', () => {
  const store = new PendingRunStore()
  const tok = { id: 'tok-a' }
  const subA = { id: 'sub-a' }
  const subB = { id: 'sub-b' }

  store.register('agent-a', tok, 'child-a', 'Engineer', { v: 1 }, subA)
  assert.equal(store.attachSubscription('agent-a', tok, subB), true)

  const claimRes = store.claim('agent-a', tok)
  assert.equal(claimRes.claimed, true)
  // 认领后即完结：再绑定被拒，返回 false 供调用方立即 Dispose
  assert.equal(store.attachSubscription('agent-a', tok, { id: 'sub-c' }), false)
  // claim 交还的是最后一次成功绑定的订阅
  assert.equal(claimRes.subscription, subB)
})

test('REG[pending-run-store-settled-2] settleParentCancelled rejects already finished record without removal', () => {
  const store = new PendingRunStore()
  const tok = { id: 'tok-b' }
  store.register('agent-b', tok, 'child-b', 'Engineer', { v: 2 })
  assert.equal(store.claim('agent-b', tok).claimed, true)

  const res = store.settleParentCancelled('agent-b', tok)
  assert.equal(res.claimed, false)
  assert.equal(res.reason, 'AlreadyFinished')
  assert.equal(store.containsAgent('agent-b'), true)
  assert.equal(store.isFinished('agent-b', tok), true)
})

test('REG[pending-run-store-settled-3] claim divides active/all views and isFinished honors token', () => {
  const store = new PendingRunStore()
  const tok1 = { id: 't1' }
  const tok2 = { id: 't2' }
  const pay1 = { name: 'p1' }
  const pay2 = { name: 'p2' }

  store.register('agent-1', tok1, 'c1', 'Engineer', pay1)
  store.register('agent-2', tok2, 'c2', 'DevOps', pay2)
  store.claim('agent-1', tok1)

  assert.deepEqual(store.activePayloads(), [pay2])

  const all = store.allPayloads()
  assert.equal(all.length, 2)
  assert.ok(all.includes(pay1))
  assert.ok(all.includes(pay2))

  const outstanding = store.snapshotOutstanding()
  assert.equal(outstanding.length, 1)
  assert.equal(outstanding[0].agentId, 'agent-2')
  assert.equal(outstanding[0].finished, false)

  assert.equal(store.isFinished('agent-1', tok1), true)
  // 缺省 token 时按记录自身 token 判定
  assert.equal(store.isFinished('agent-1'), true)
  assert.equal(store.isFinished('agent-1', { wrong: true }), false)
  assert.equal(store.isFinished('agent-2', tok2), false)
})

test('REG[pending-run-store-settled-4] re-register replaces record and resets settled state', () => {
  const store = new PendingRunStore()
  const tokOld = { id: 'tok-old' }
  const tokNew = { id: 'tok-new' }
  const payOld = { v: 'old' }
  const payNew = { v: 'new' }

  store.register('agent-r', tokOld, 'c', 'Engineer', payOld)
  store.claim('agent-r', tokOld)
  assert.equal(store.isFinished('agent-r', tokOld), true)

  const res = store.register('agent-r', tokNew, 'c', 'Engineer', payNew)
  assert.equal(res.registered, true)
  assert.equal(res.previousReplaced, true)
  assert.equal(store.isFinished('agent-r', tokNew), false)
  assert.equal(store.tryGetPayload('agent-r'), payNew)

  // 旧 token 对新记录失效
  const stale = store.claim('agent-r', tokOld)
  assert.equal(stale.claimed, false)
  assert.equal(stale.reason, 'TokenMismatch')

  // 新 token 可认领
  const fresh = store.claim('agent-r', tokNew)
  assert.equal(fresh.claimed, true)
  assert.equal(fresh.payload, payNew)
})
