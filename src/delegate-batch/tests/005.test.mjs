import test from 'node:test'
import assert from 'node:assert/strict'

import { SyncDelegateBatchStore } from 'wanxiangli/delegate-batch'

test('SPEC[sync-batch-6] 批次准入后（无论派发与否、调用是否弹出）admit 一律拒绝；releaseAdmission 后槽位复用', () => {
  const store = new SyncDelegateBatchStore()

  // 单调用批次：派发后 admit 被拒，弹出调用后仍被拒，释放后恢复
  assert.equal(store.admit('scope-A', 'engineer', 'inv-1', null).verdict, 'single')
  assert.deepEqual(
    store.beginCall('owner-A', 'scope-A', 'engineer', 'del-A', 'agent-A', ['inv-1'], 'call-1'),
    { ok: true }
  )
  assert.deepEqual(store.admit('scope-A', 'engineer', 'inv-1b', null), { verdict: 'reject', reason: 'ActiveBatch' })
  assert.equal(store.tryPopCallByDelegate('del-A'), 'call-1')
  assert.deepEqual(store.admit('scope-A', 'engineer', 'inv-1c', null), { verdict: 'reject', reason: 'ActiveBatch' })
  store.releaseAdmission('scope-A', 'engineer')
  assert.equal(store.admit('scope-A', 'engineer', 'inv-2', null).verdict, 'single')

  // 多调用批次：凑齐但未派发，同样拒绝再次 admit
  assert.equal(store.admit('scope-B', 'engineer', 'inv-b1', { providerRun: 'run-B', callOrder: ['c1', 'c2'], currentCall: 'c1' }).verdict, 'wait')
  assert.deepEqual(
    store.admit('scope-B', 'engineer', 'inv-b2', { providerRun: 'run-B', callOrder: ['c1', 'c2'], currentCall: 'c2' }),
    { verdict: 'ready', invocations: ['inv-b1', 'inv-b2'] }
  )
  assert.deepEqual(store.admit('scope-B', 'engineer', 'inv-b3', null), { verdict: 'reject', reason: 'ActiveBatch' })
})

test('SPEC[sync-batch-7] cancelScope / clearAll 结算覆盖单调用与凑齐批次的全部 invocation，不重不漏', () => {
  const store = new SyncDelegateBatchStore()

  // scope-C：凑齐未派发的批次
  store.admit('scope-C', 'engineer', 'inv-c1', { providerRun: 'run-C', callOrder: ['c1', 'c2'], currentCall: 'c1' })
  const ready = store.admit('scope-C', 'engineer', 'inv-c2', { providerRun: 'run-C', callOrder: ['c1', 'c2'], currentCall: 'c2' })
  assert.equal(ready.verdict, 'ready')

  // scope-D：已派发的单调用批次
  store.admit('scope-D', 'engineer', 'inv-d1', null)
  assert.deepEqual(
    store.beginCall('owner-D', 'scope-D', 'engineer', 'del-D', 'agent-D', ['inv-d1'], 'call-D1'),
    { ok: true }
  )

  const settledC = store.cancelScope('scope-C')
  assert.deepEqual([...settledC.cancelledInvocations].sort(), ['inv-c1', 'inv-c2'])
  assert.deepEqual(settledC.cancelledCalls, [])
  assert.equal(store.batchesCount, 1)

  const settledD = store.cancelScope('scope-D')
  assert.deepEqual(settledD.cancelledInvocations, ['inv-d1'])
  assert.deepEqual(settledD.cancelledCalls, ['call-D1'])
  assert.equal(store.batchesCount, 0)
  assert.equal(store.activeCallsCount, 0)

  const rest = store.clearAll()
  assert.deepEqual(rest.cancelledCalls, [])
  assert.deepEqual(rest.cancelledInvocations, [])
})