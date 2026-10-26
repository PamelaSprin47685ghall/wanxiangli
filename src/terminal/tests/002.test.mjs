import test from 'node:test'
import assert from 'node:assert/strict'

import { MessageVisibilityHub, messageVisibilityHub } from 'wanxiangli/terminal'

const fakeTimerFactory = () => {
  const deadlines = []
  const factory = (ms) => {
    let release
    const promise = new Promise((resolve) => {
      release = () => {
        if (!handle.cancelled) resolve()
      }
    })
    const handle = {
      ms,
      cancelled: false,
      Delay: promise,
      Cancel() {
        this.cancelled = true
      },
      release,
    }
    deadlines.push(handle)
    return handle
  }
  return { factory, deadlines }
}

const fakeTimerPort = () => {
  const deadlines = []
  const port = {
    Delay(ms) {
      let release
      const promise = new Promise((resolve) => {
        release = () => {
          if (!handle.cancelled) resolve()
        }
      })
      const handle = {
        ms,
        cancelled: false,
        Delay: promise,
        Cancel() {
          this.cancelled = true
        },
        release,
      }
      deadlines.push(handle)
      return handle
    },
    Dispose() {},
  }
  return { port, deadlines }
}

test('WHAT[host-boundary-terminal-002] Notify 唤醒同 session 多个等待者，触发 Cancel() 并使 PendingCount 归零', async () => {
  const { factory, deadlines } = fakeTimerFactory()
  const hub = new MessageVisibilityHub(factory)

  let woke1 = false
  let woke2 = false
  const p1 = hub.AwaitChange('s1', 100).then(() => { woke1 = true })
  const p2 = hub.AwaitChange('s1', 200).then(() => { woke2 = true })

  assert.equal(hub.PendingCount('s1'), 2)
  assert.equal(deadlines.length, 2)
  assert.equal(deadlines[0].cancelled, false)
  assert.equal(deadlines[1].cancelled, false)

  hub.Notify('s1')
  await Promise.all([p1, p2])

  assert.equal(woke1, true)
  assert.equal(woke2, true)
  assert.equal(deadlines[0].cancelled, true, 'Notify 必须触发 deadline 的 Cancel()')
  assert.equal(deadlines[1].cancelled, true, 'Notify 必须触发 deadline 的 Cancel()')
  assert.equal(hub.PendingCount('s1'), 0, '唤醒后 PendingCount 必须归零')
})

test('WHAT[host-boundary-terminal-002] 超时到期自动结算并移除 waiter 且 PendingCount 归零，不触发 Cancel()', async () => {
  const { factory, deadlines } = fakeTimerFactory()
  const hub = new MessageVisibilityHub(factory)

  let woke = false
  const p = hub.AwaitChange('s2', 150).then(() => { woke = true })
  assert.equal(hub.PendingCount('s2'), 1)

  deadlines[0].release()
  await p

  assert.equal(woke, true)
  assert.equal(deadlines[0].cancelled, false, '超时自然到期不应触发 Cancel()')
  assert.equal(hub.PendingCount('s2'), 0, '超时到期后 PendingCount 必须归零且无键残留')
})

test('WHAT[host-boundary-terminal-002] 先 Notify 后到期与先到期后 Notify 的幂等性，不影响新注册的 waiter', async () => {
  const { factory, deadlines } = fakeTimerFactory()
  const hub = new MessageVisibilityHub(factory)

  // 1. 先 Notify，后 release deadline
  const p1 = hub.AwaitChange('s3', 50)
  assert.equal(hub.PendingCount('s3'), 1)
  hub.Notify('s3')
  await p1
  assert.equal(hub.PendingCount('s3'), 0)
  deadlines[0].release()
  assert.equal(hub.PendingCount('s3'), 0)

  // 2. 重新注册新 waiter，必须正常工作
  let woke2 = false
  const p2 = hub.AwaitChange('s3', 60).then(() => { woke2 = true })
  assert.equal(hub.PendingCount('s3'), 1)
  hub.Notify('s3')
  await p2
  assert.equal(woke2, true)
  assert.equal(hub.PendingCount('s3'), 0)

  // 3. 先到期，后 Notify
  let woke3 = false
  const p3 = hub.AwaitChange('s3', 70).then(() => { woke3 = true })
  assert.equal(hub.PendingCount('s3'), 1)
  deadlines[2].release()
  await p3
  assert.equal(woke3, true)
  assert.equal(hub.PendingCount('s3'), 0)
  hub.Notify('s3')
  assert.equal(hub.PendingCount('s3'), 0)
})

test('WHAT[host-boundary-terminal-002] 不同 session 之间完全隔离', async () => {
  const { factory, deadlines } = fakeTimerFactory()
  const hub = new MessageVisibilityHub(factory)

  let wokeA = false
  let wokeB = false
  const pA = hub.AwaitChange('session-a', 100).then(() => { wokeA = true })
  const pB = hub.AwaitChange('session-b', 100).then(() => { wokeB = true })

  assert.equal(hub.PendingCount('session-a'), 1)
  assert.equal(hub.PendingCount('session-b'), 1)

  hub.Notify('session-a')
  await pA

  assert.equal(wokeA, true)
  assert.equal(wokeB, false, 'session-a 的 Notify 绝不能唤醒 session-b')
  assert.equal(hub.PendingCount('session-a'), 0)
  assert.equal(hub.PendingCount('session-b'), 1)

  deadlines[1].release()
  await pB
  assert.equal(wokeB, true)
  assert.equal(hub.PendingCount('session-b'), 0)
})

test('WHAT[host-boundary-terminal-002] Clear 与 ClearAll 能够排空并取消 waiters', async () => {
  const { factory, deadlines } = fakeTimerFactory()
  const hub = new MessageVisibilityHub(factory)

  let wokeX1 = false
  let wokeX2 = false
  let wokeY = false
  const pX1 = hub.AwaitChange('s-x', 100).then(() => { wokeX1 = true })
  const pX2 = hub.AwaitChange('s-x', 100).then(() => { wokeX2 = true })
  const pY = hub.AwaitChange('s-y', 100).then(() => { wokeY = true })

  assert.equal(hub.PendingCount('s-x'), 2)
  assert.equal(hub.PendingCount('s-y'), 1)

  hub.Clear('s-x')
  await Promise.all([pX1, pX2])

  assert.equal(wokeX1, true)
  assert.equal(wokeX2, true)
  assert.equal(deadlines[0].cancelled, true)
  assert.equal(deadlines[1].cancelled, true)
  assert.equal(hub.PendingCount('s-x'), 0)
  assert.equal(hub.PendingCount('s-y'), 1)

  hub.ClearAll()
  await pY
  assert.equal(wokeY, true)
  assert.equal(deadlines[2].cancelled, true)
  assert.equal(hub.PendingCount('s-y'), 0)
})

test('WHAT[host-boundary-terminal-002] 宿主 duck-typed timerPort 对象接口兼容', async () => {
  const { port, deadlines } = fakeTimerPort()
  const hub = new MessageVisibilityHub(port)

  let woke = false
  const p = hub.AwaitChange('ses-port', 80).then(() => { woke = true })
  assert.equal(hub.PendingCount('ses-port'), 1)

  hub.Notify('ses-port')
  await p

  assert.equal(woke, true)
  assert.equal(deadlines[0].cancelled, true)
  assert.equal(hub.PendingCount('ses-port'), 0)
})

test('WHAT[host-boundary-terminal-002] 独立实例与全局单例 messageVisibilityHub（默认内建 timer）正常工作', async () => {
  // 1. 独立实例无参构造（默认内建 setTimeout）
  const defaultHub = new MessageVisibilityHub()
  assert.equal(defaultHub.PendingCount('ses-default'), 0)

  let defaultWoke = false
  const p1 = defaultHub.AwaitChange('ses-default', 5).then(() => { defaultWoke = true })
  assert.equal(defaultHub.PendingCount('ses-default'), 1)

  await p1
  assert.equal(defaultWoke, true)
  assert.equal(defaultHub.PendingCount('ses-default'), 0)

  // 2. 全局单例 messageVisibilityHub
  assert.equal(messageVisibilityHub.PendingCount('ses-singleton'), 0)
  let singletonWoke = false
  const p2 = messageVisibilityHub.AwaitChange('ses-singleton', 5).then(() => { singletonWoke = true })
  assert.equal(messageVisibilityHub.PendingCount('ses-singleton'), 1)

  await p2
  assert.equal(singletonWoke, true)
  assert.equal(messageVisibilityHub.PendingCount('ses-singleton'), 0)
})
