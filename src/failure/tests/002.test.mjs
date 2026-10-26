import test from 'node:test'
import assert from 'node:assert/strict'

import { ProviderAttemptStopFence, providerAttemptStopFence } from 'wanxiangli/failure'

test('SPEC[failure-fence-001] 先 SignalStop 后 Register 必须得 AlreadyStopped', () => {
  const fence = new ProviderAttemptStopFence()
  fence.SignalStop('ses-1', 'run-1')

  const res = fence.Register('ses-1', 'run-1')
  assert.equal(res, 'AlreadyStopped')

  assert.deepEqual(fence.Snapshot(), { stopped: 1, waiting: 0, denied: 0 })
})

test('SPEC[failure-fence-002] 先 Register 后 SignalStop 唤醒', async () => {
  const fence = new ProviderAttemptStopFence()

  const regRes = fence.Register('ses-1', 'run-1')
  assert.equal(regRes, 'Admitted')
  assert.deepEqual(fence.Snapshot(), { stopped: 0, waiting: 1, denied: 0 })

  const pending = fence.WaitForStop('ses-1', 'run-1')
  fence.SignalStop('ses-1', 'run-1')

  const waitRes = await pending
  assert.equal(waitRes, 'Stopped')
  assert.deepEqual(fence.Snapshot(), { stopped: 1, waiting: 0, denied: 0 })
})

test('SPEC[failure-fence-003] 无停止时 WaitForStop 得 TimedOut', async () => {
  const fence = new ProviderAttemptStopFence()

  const waitRes = await fence.WaitForStop('ses-1', 'run-1', 20)
  assert.equal(waitRes, 'TimedOut')
  // 超时后 waiter 从 waiting 字典中被移除，不发生资源泄漏
  assert.deepEqual(fence.Snapshot(), { stopped: 0, waiting: 0, denied: 0 })
})

test('SPEC[failure-fence-004] Clear 之后同一 attempt 可重新 Register', () => {
  const fence = new ProviderAttemptStopFence()

  fence.SignalStop('ses-1', 'run-1')
  assert.equal(fence.Register('ses-1', 'run-1'), 'AlreadyStopped')

  fence.Clear('ses-1')
  assert.deepEqual(fence.Snapshot(), { stopped: 0, waiting: 0, denied: 0 })

  // 清除后重新登记应该被接纳
  assert.equal(fence.Register('ses-1', 'run-1'), 'Admitted')
})

test('SPEC[failure-fence-005] 重复 SignalStop 幂等且不重复唤醒', async () => {
  const fence = new ProviderAttemptStopFence()

  fence.SignalStop('ses-1', 'run-1')
  fence.SignalStop('ses-1', 'run-1')
  assert.deepEqual(fence.Snapshot(), { stopped: 1, waiting: 0, denied: 0 })

  const waitRes = await fence.WaitForStop('ses-1', 'run-1')
  assert.equal(waitRes, 'Stopped')
})

test('SPEC[failure-fence-006] Revoke 只影响目标会话且不污染后续 attempt', async () => {
  const fence = new ProviderAttemptStopFence()

  const pendingA = fence.WaitForStop('ses-a', 'run-1')
  const pendingB = fence.WaitForStop('ses-b', 'run-1')
  assert.deepEqual(fence.Snapshot(), { stopped: 0, waiting: 2, denied: 0 })

  fence.Revoke('ses-a')

  assert.equal(await pendingA, 'Denied')
  assert.deepEqual(fence.Snapshot(), { stopped: 0, waiting: 1, denied: 1 })

  // ses-b 仍处于等待中
  fence.SignalStop('ses-b', 'run-1')
  assert.equal(await pendingB, 'Stopped')
  assert.deepEqual(fence.Snapshot(), { stopped: 1, waiting: 0, denied: 1 })

  // ses-a 的新 attempt 是不同的 key，依然正常 Admitted
  const regLater = fence.Register('ses-a', 'run-2')
  assert.equal(regLater, 'Admitted')
  assert.deepEqual(fence.Snapshot(), { stopped: 1, waiting: 1, denied: 1 })
})

test('SPEC[failure-fence-007] 重复 Clear 幂等且不误伤新 attempt', () => {
  const fence = new ProviderAttemptStopFence()

  fence.SignalStop('ses-1', 'run-1')
  fence.Clear('ses-1')
  fence.Clear('ses-1') // 重复 Clear 幂等

  assert.equal(fence.Register('ses-1', 'run-1'), 'Admitted')
  assert.deepEqual(fence.Snapshot(), { stopped: 0, waiting: 1, denied: 0 })
})

test('SPEC[failure-fence-008] ClearAll 清除所有会话状态', async () => {
  const fence = new ProviderAttemptStopFence()

  const p1 = fence.WaitForStop('ses-1', 'run-1')
  const p2 = fence.WaitForStop('ses-2', 'run-2')
  fence.SignalStop('ses-3', 'run-3')

  assert.deepEqual(fence.Snapshot(), { stopped: 1, waiting: 2, denied: 0 })

  fence.ClearAll()

  assert.equal(await p1, 'Denied')
  assert.equal(await p2, 'Denied')
  assert.deepEqual(fence.Snapshot(), { stopped: 0, waiting: 0, denied: 0 })
})

test('SPEC[failure-fence-009] 全局单例 providerAttemptStopFence 可用', () => {
  assert.ok(providerAttemptStopFence instanceof ProviderAttemptStopFence)
  const snap = providerAttemptStopFence.Snapshot()
  assert.equal(typeof snap.stopped, 'number')
  assert.equal(typeof snap.waiting, 'number')
  assert.equal(typeof snap.denied, 'number')
})
