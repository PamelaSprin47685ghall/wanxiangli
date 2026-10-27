import test from 'node:test'
import assert from 'node:assert/strict'
import { PromptPhysicalAcceptance, promptPhysicalAcceptance } from 'wanxiangli/dispatch'

test('SPEC[prompt-physical-acceptance-1] accepted 原子排空、单次回调通知并结算所有 waiters', async () => {
  const pa = new PromptPhysicalAcceptance()
  const key = 'pk-exact-1'
  const seen = []
  const sub = pa.register(key, pid => seen.push(pid))

  const [w1] = pa.beginConfirmation(key, 1000)
  const [w2] = pa.beginConfirmation(key, 1000)

  pa.accepted(key, 'msg-phys-1')

  assert.deepEqual(seen, ['msg-phys-1'], 'callback must be called exactly once with physical ID')

  const res1 = await w1
  const res2 = await w2
  assert.deepEqual(res1, { kind: 'Accepted', physicalUserMessageId: 'msg-phys-1' })
  assert.deepEqual(res2, { kind: 'Accepted', physicalUserMessageId: 'msg-phys-1' })

  // 状态已排空，再次 accepted 不再触发原有回调
  pa.accepted(key, 'msg-phys-late')
  assert.deepEqual(seen, ['msg-phys-1'], 'drained state must not notify again')

  sub.Dispose?.() ?? sub.dispose?.()
})

test('SPEC[prompt-physical-acceptance-2] ABA 覆盖后旧租约释放绝不误删覆盖后的新监听者 (ABA defense)', () => {
  const pa = new PromptPhysicalAcceptance()
  const key = 'pk-aba-test'
  const oldSeen = []
  const newSeen = []

  const firstSub = pa.register(key, pid => oldSeen.push(pid))
  const secondSub = pa.register(key, pid => newSeen.push(pid))

  // 释放旧的租约
  firstSub.Dispose?.() ?? firstSub.dispose?.()
  // 重复释放旧租约必须安全幂等
  firstSub.Dispose?.() ?? firstSub.dispose?.()

  // 物理消息到达
  pa.accepted(key, 'msg-aba-landed')

  assert.deepEqual(oldSeen, [], 'old disposed registration must never be notified')
  assert.deepEqual(newSeen, ['msg-aba-landed'], 'current registration must remain intact after old lease disposal')

  secondSub.Dispose?.() ?? secondSub.dispose?.()
})

test('SPEC[prompt-physical-acceptance-3] 多等待者局部取消与防泄漏 (partial cancellation and leak prevention)', async () => {
  const pa = new PromptPhysicalAcceptance()
  const key = 'pk-multi-waiters'

  const [w1, sub1] = pa.beginConfirmation(key, 2000)
  const [w2, sub2] = pa.beginConfirmation(key, 2000)

  // 主动释放 w1
  sub1.Dispose?.() ?? sub1.dispose?.()
  const res1 = await w1
  assert.equal(res1, undefined, 'cancelled waiter must resolve to undefined / None')

  // 此时 w2 仍然在等待，物理确认到达
  pa.accepted(key, 'msg-multi-landed')
  const res2 = await w2
  assert.deepEqual(res2, { kind: 'Accepted', physicalUserMessageId: 'msg-multi-landed' }, 'surviving waiter must receive Accepted')

  sub2.Dispose?.() ?? sub2.dispose?.()
})

test('SPEC[prompt-physical-acceptance-4] cancel 与 rejected 将 waiters 置为 Rejected 状态', async () => {
  const pa = new PromptPhysicalAcceptance()
  const keyCancel = 'pk-cancel'
  const seenCancel = []
  pa.register(keyCancel, pid => seenCancel.push(pid))
  const [wCancel] = pa.beginConfirmation(keyCancel, 1000)

  pa.cancel(keyCancel)
  assert.deepEqual(seenCancel, [], 'cancel must not invoke acceptance callback')
  const resCancel = await wCancel
  assert.deepEqual(resCancel, { kind: 'Rejected', reason: 'Cancelled' })

  const keyReject = 'pk-reject'
  const [wReject] = pa.beginConfirmation(keyReject, 1000)
  pa.rejected(keyReject, 'explicit port error')
  const resReject = await wReject
  assert.deepEqual(resReject, { kind: 'Rejected', reason: 'explicit port error' })
})

test('SPEC[prompt-physical-acceptance-5] 迟到到达 (Late arrival) 安全忽略，不抛错且不驻留垃圾状态', () => {
  const pa = new PromptPhysicalAcceptance()
  assert.doesNotThrow(() => {
    pa.accepted('non-existent-key', 'msg-late')
    pa.cancel('non-existent-key')
    pa.rejected('non-existent-key', 'any-reason')
  })
})

test('SPEC[prompt-physical-acceptance-6] 回调函数重入调用安全，原子排空保证不发生死锁或二次污染', () => {
  const pa = new PromptPhysicalAcceptance()
  const key = 'pk-reentrant'
  const log = []

  pa.register(key, pid => {
    log.push(`notify:${pid}`)
    // 重入调用成员
    pa.accepted(key, 'nested-accepted')
    pa.cancel(key)
    pa.register('pk-other', () => {})
  })

  pa.accepted(key, 'primary-msg')
  assert.deepEqual(log, ['notify:primary-msg'])
})

test('SPEC[prompt-physical-acceptance-7] 独立实例隔离与全局单例可用性', () => {
  const pa1 = new PromptPhysicalAcceptance()
  const pa2 = new PromptPhysicalAcceptance()
  const seen1 = []
  const seen2 = []

  pa1.register('key-shared', pid => seen1.push(pid))
  pa2.register('key-shared', pid => seen2.push(pid))

  pa1.accepted('key-shared', 'pid-1')
  assert.deepEqual(seen1, ['pid-1'])
  assert.deepEqual(seen2, [], 'instance pa2 must be completely isolated from pa1')

  assert.ok(promptPhysicalAcceptance instanceof PromptPhysicalAcceptance, 'singleton must be instance of PromptPhysicalAcceptance')
  promptPhysicalAcceptance.clear()
})
