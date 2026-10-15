import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Wait } from '../../../dist/wait/Wait.js'

// 卡内红反例 2 的邮箱变体：取消/中断不得偷掉其他 waiter 的唤醒。

test('WHAT[CAUSAL-WAIT-009] a completion mailbox works without any registry', async () => {
  const box = Wait.completionMailbox()
  // 主仓语义：PulseWake 只唤醒已注册的 waiter（脉冲不持久），
  // 因此先注册等待、再脉冲；队列非空时 WaitForWake 立即返回。
  const wake = box.waitForWake()
  box.pulseWake()
  assert.equal(await wake, 'CompletionMayBeAvailable')
  assert.equal(box.isCancelled(), false)
  assert.equal(box.cancel(), true)
  assert.equal(box.cancel(), false)
  assert.equal(box.isCancelled(), true)
})

test('WHAT[CAUSAL-WAIT-009] cancelling wakes every waiter exactly once', async () => {
  const box = Wait.completionMailbox()
  const reasons = []
  const waiters = [box.waitForWake(), box.waitForWake(), box.waitForWake()]
  waiters.forEach(waiter => waiter.then(reason => reasons.push(reason)))

  box.cancel()
  await Promise.all(waiters)
  assert.equal(reasons.length, 3)
  assert.ok(reasons.every(reason => reason === 'MailboxCancelled'))
})

test('WHAT[CAUSAL-WAIT-009] one waiter resolving does not consume another waiter', async () => {
  const box = Wait.completionMailbox()
  let secondWoke = false
  const second = box.waitForWake().then(reason => { secondWoke = true; return reason })
  box.pulseAgent('agent-1')
  await box.waitForWake()
  // 主仓语义：wake 是广播（wakeAll）——第二个 waiter 同样被唤醒，
  // 且 agent 队列不被第一个 waiter 的返回消费。
  assert.equal(secondWoke, true)
  box.pulseAgent('agent-2')
  assert.equal(await second, 'CompletionMayBeAvailable')
})

test('WHAT[CAUSAL-WAIT-009] a local interrupt competes with the mailbox wake', async () => {
  const box = Wait.completionMailbox()
  const interrupt = Wait.interrupt()
  const outcome = box.waitForSignal(interrupt.wait)
  interrupt.signal('OperatorAbort')
  const reason = await outcome
  assert.deepEqual(reason, { LocalInterrupt: 'OperatorAbort' })
})

test('WHAT[CAUSAL-WAIT-009] the join batch bound is exported as contract vocabulary', () => {
  assert.equal(Wait.maxJoinBatch, 32)
})

test('WHAT[CAUSAL-WAIT-009] the wait module imports no sibling library and no runtime service', async () => {
  const source = await readFile(new URL('../../../dist/wait/Wait.js', import.meta.url), 'utf8')
  assert.equal(source.includes('wanxiangli/'), false)
  assert.equal(source.includes('node:fs'), false)
  assert.equal(source.includes('node:sqlite'), false)
})
