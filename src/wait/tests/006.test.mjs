import test from 'node:test'
import assert from 'node:assert/strict'
import { Wait } from '../../../dist/wait/Wait.js'
import { describe, registry, virtualTimer } from './support.mjs'

// 卡内红反例 3：等待超时不得伪造业务成功，也不得残留活跃租约或悬空定时器。

test('WHAT[CAUSAL-WAIT-006] deadline expiry returns WaitTimedOut and leaves no active wait', async () => {
  const runtime = registry()
  const virtual = virtualTimer()
  const deadline = virtual.delay(50)

  const outcome = Wait.untilSignalOrDeadline(
    runtime,
    describe({ ownerId: 'expiry' }),
    deadline,
    () => null,
    () => new Promise(() => {}),
  )

  virtual.advance(50)
  const result = await outcome

  assert.deepEqual(result, { ok: false, reason: 'WaitTimedOut' })
  assert.equal(Wait.snapshot(runtime).active.length, 0)
  const history = Wait.snapshot(runtime).history
  assert.equal(history[history.length - 1].exit, 'WaitTimedOut')
})

test('WHAT[CAUSAL-WAIT-006] a signal win cancels the deadline and no timer survives', async () => {
  const runtime = registry()
  const virtual = virtualTimer()
  const deadline = virtual.delay(50)

  let reads = 0
  const outcome = Wait.untilSignalOrDeadline(
    runtime,
    describe({ ownerId: 'signal' }),
    deadline,
    () => (reads === 0 ? null : { value: 'delivered' }),
    () => {
      reads += 1
      return Promise.resolve()
    },
  )

  await Promise.resolve()
  const result = await outcome

  assert.deepEqual(result, { ok: true, value: { value: 'delivered' } })
  // 信号胜出必须立即取消截止句柄。
  assert.equal(deadline.cancels, 1)

  // 推进虚拟时钟越过原定截止点：已取消的定时器不得触发过期回调。
  let expired = false
  deadline.Delay.then(() => { expired = true })
  virtual.advance(100)
  await Promise.resolve()
  assert.equal(expired, false)

  assert.equal(Wait.snapshot(runtime).active.length, 0)
})

test('WHAT[CAUSAL-WAIT-006] an immediate read resolves without ever suspending', async () => {
  const runtime = registry()
  const virtual = virtualTimer()
  const deadline = virtual.delay(50)

  const result = await Wait.untilSignalOrDeadline(
    runtime,
    describe({ ownerId: 'immediate' }),
    deadline,
    () => 'already-there',
    () => { throw new Error('signal must not be awaited') },
  )

  assert.deepEqual(result, { ok: true, value: 'already-there' })
  assert.equal(deadline.cancels, 1)
  assert.equal(Wait.snapshot(runtime).history[1].exit, 'WaitResolved')
  virtual.advance(50)
})

test('WHAT[CAUSAL-WAIT-006] lease release is idempotent and does not revive', () => {
  const runtime = registry()
  const lease = Wait.enter(runtime, describe())
  Wait.markExit(lease, 'WaitCancelled')
  Wait.dispose(lease)
  Wait.dispose(lease)
  Wait.markExit(lease, 'WaitResolved')

  const snapshot = Wait.snapshot(runtime)
  assert.equal(snapshot.active.length, 0)
  assert.equal(snapshot.history.length, 2)
  // 第一次 dispose 已记录退出；重复调用不再追加转移。
  assert.equal(snapshot.history[1].exit, 'WaitCancelled')
})

test('WHAT[CAUSAL-WAIT-006] disposing one wait leaves the others active', () => {
  const runtime = registry()
  const one = Wait.enter(runtime, describe({ ownerId: 'one' }))
  const two = Wait.enter(runtime, describe({ ownerId: 'two' }))
  Wait.dispose(one)
  const active = Wait.snapshot(runtime).active
  assert.equal(active.length, 1)
  assert.equal(active[0].owner.identity.id, 'two')
  Wait.dispose(two)
})
