import test from 'node:test'
import assert from 'node:assert/strict'

import { TerminalRegistry, TerminalBus, TerminalOutcome } from 'wanxiangli/terminal'

const completed = (runId, payload) => TerminalOutcome.Completed(runId, payload)
const failed = (payload) => TerminalOutcome.Failed(payload)
const aborted = (payload) => TerminalOutcome.Aborted(payload)

test('WHAT[host-boundary-terminal-001] 重复 Completed 去重，无 runId 及 Failed/Aborted 不去重', () => {
  const faults = []
  const registry = new TerminalRegistry(err => faults.push(err))
  const received = []
  registry.SubscribeProcessTerminal((session, outcome) => received.push({ session, outcome }))

  // 1. 同会话相同 runId 的 Completed 首次成功，二次去重（返回 false）
  const first = registry.NotifyTerminal('s1', completed('run-1', 'res-1'))
  assert.equal(first, true, '首次 NotifyTerminal 应该成功且存在监听者')
  const dup = registry.NotifyTerminal('s1', completed('run-1', 'res-1-dup'))
  assert.equal(dup, false, '重复 run-1 的 Completed 必须去重并返回 false')
  assert.equal(received.length, 1, '重复 Completed 不得投递给监听者')

  // 2. 相同会话不同 runId 的 Completed 正常接收
  const secondRun = registry.NotifyTerminal('s1', completed('run-2', 'res-2'))
  assert.equal(secondRun, true)
  assert.equal(received.length, 2)

  // 3. 无 runId 的 Completed 不去重
  const noRun1 = registry.NotifyTerminal('s2', completed(undefined, 'no-run-1'))
  const noRun2 = registry.NotifyTerminal('s2', completed(undefined, 'no-run-2'))
  assert.equal(noRun1, true)
  assert.equal(noRun2, true)
  assert.equal(received.length, 4)

  // 4. Failed 与 Aborted 绝不去重
  const fail1 = registry.NotifyTerminal('s3', failed('error-1'))
  const fail2 = registry.NotifyTerminal('s3', failed('error-1'))
  const abort1 = registry.NotifyTerminal('s3', aborted('stop-1'))
  const abort2 = registry.NotifyTerminal('s3', aborted('stop-1'))
  assert.equal(fail1, true)
  assert.equal(fail2, true)
  assert.equal(abort1, true)
  assert.equal(abort2, true)
  assert.equal(received.length, 8)
  assert.equal(faults.length, 0)
})

test('WHAT[host-boundary-terminal-001] 注册即回放 sticky 与 future-only 分开，未见会话不回放', () => {
  const faults = []
  const registry = new TerminalRegistry(err => faults.push(err))

  // 先证明一个 terminal 事实
  registry.NotifyTerminal('ses-sticky', completed('run-a', 'result-a'))

  // 1. 晚到的会话级 sticky 监听器立即回放最新事实
  const stickyReceived = []
  const sub1 = registry.SubscribeTerminal('ses-sticky', (s, o) => stickyReceived.push({ s, o }))
  assert.equal(stickyReceived.length, 1, '注册即应收到 sticky 回放')
  assert.equal(stickyReceived[0].s, 'ses-sticky')

  // 2. 未见过的会话不回放
  const otherReceived = []
  const sub2 = registry.SubscribeTerminal('ses-never-seen', (s, o) => otherReceived.push({ s, o }))
  assert.equal(otherReceived.length, 0, '未发生过的会话不得收到回放')

  // 3. future-only 订阅不回放已有 sticky 事实，只接收未来事实
  const futureReceived = []
  const sub3 = registry.SubscribeFutureTerminal('ses-sticky', (s, o) => futureReceived.push({ s, o }))
  assert.equal(futureReceived.length, 0, 'future-only 不得接收 sticky 回放')

  // 4. 未来事实到达时，sticky 与 future 均接收
  registry.NotifyTerminal('ses-sticky', failed('subsequent-failure'))
  assert.equal(stickyReceived.length, 2)
  assert.equal(futureReceived.length, 1)

  sub1.Dispose()
  sub2.Dispose()
  sub3.Dispose()
})

test('WHAT[host-boundary-terminal-001] sticky FIFO 上限 256，同会话更新不刷新队列顺序，超限淘汰最早会话', () => {
  const registry = new TerminalRegistry(() => {})

  // 填充 256 个会话
  for (let i = 1; i <= 256; i++) {
    registry.NotifyTerminal('s-' + i, completed('run-' + i, 'payload-' + i))
  }

  // 更新第 1 个会话的内容（同会话更新不得重新入队）
  registry.NotifyTerminal('s-1', completed('run-1-updated', 'payload-1-updated'))

  // 验证 s-1 的最新 sticky
  const s1Replay = []
  registry.SubscribeTerminal('s-1', (s, o) => s1Replay.push(o))
  assert.equal(s1Replay.length, 1)

  // 写入第 257 个会话：触发 FIFO 淘汰，最早入队的 s-1 必须被淘汰
  registry.NotifyTerminal('s-257', completed('run-257', 'payload-257'))

  // 再次对 s-1 注册 sticky，已被淘汰，不应收到任何回放
  const evictedReplay = []
  registry.SubscribeTerminal('s-1', (s, o) => evictedReplay.push(o))
  assert.equal(evictedReplay.length, 0, '超过 256 之后最早入队的 s-1 必须已被淘汰')

  // 而 s-2 仍未被淘汰
  const s2Replay = []
  registry.SubscribeTerminal('s-2', (s, o) => s2Replay.push(o))
  assert.equal(s2Replay.length, 1, 's-2 应在 sticky 缓存中')
})

test('WHAT[host-boundary-terminal-001] process 级与会话级订阅区分，HasSubscriber 仅计算会话级', () => {
  const registry = new TerminalRegistry(() => {})

  // 没有任何订阅时
  assert.equal(registry.HasSubscriber('target-session'), false)

  // 注册全局 process 级订阅
  const procSub = registry.SubscribeProcessTerminal(() => {})
  assert.equal(registry.HasSubscriber('target-session'), false, 'process 级订阅不使 HasSubscriber 变真')

  // 注册会话级订阅
  const sessionSub = registry.SubscribeTerminal('target-session', () => {})
  assert.equal(registry.HasSubscriber('target-session'), true, '会话级订阅存在时 HasSubscriber 为真')
  assert.equal(registry.HasSubscriber('other-session'), false, '对其他会话依然为假')

  // dispose 后 HasSubscriber 变回假
  sessionSub.Dispose()
  assert.equal(registry.HasSubscriber('target-session'), false, 'dispose 之后 HasSubscriber 为假')
  procSub.Dispose()
})

test('WHAT[host-boundary-terminal-001] dispose 先置 Live=false，在途快照不投递；单监听报错隔离不影响其余监听', () => {
  const faults = []
  const registry = new TerminalRegistry(err => faults.push(err))

  const order = []
  let badSub
  const goodSub1 = registry.SubscribeTerminal('ses-x', () => {
    order.push('good1')
    // 在 good1 运行中，将 badSub dispose
    badSub.Dispose()
  })

  badSub = registry.SubscribeTerminal('ses-x', () => {
    order.push('bad-should-not-run')
  })

  const throwingSub = registry.SubscribeTerminal('ses-x', () => {
    order.push('throwing')
    throw new Error('boom-from-listener')
  })

  const goodSub2 = registry.SubscribeTerminal('ses-x', () => {
    order.push('good2')
  })

  registry.NotifyTerminal('ses-x', completed('r1', 'ok'))

  assert.deepEqual(order, ['good1', 'throwing', 'good2'], '被提前 dispose 的 badSub 不投递，报错不阻止后续 good2')
  assert.equal(faults.length, 1)
  assert.match(faults[0].message, /boom-from-listener/)

  goodSub1.Dispose()
  throwingSub.Dispose()
  goodSub2.Dispose()
})

test('WHAT[host-boundary-terminal-001] TerminalBus 引用计数管理、first-wins 与 ReferenceEquals 判定', () => {
  const bus = new TerminalBus()
  const candidate1 = new TerminalRegistry(() => {})
  const candidate2 = new TerminalRegistry(() => {})

  // 1. 首次 acquire 返回 candidate1，refcount = 1
  const first = bus.Acquire('ws-1', candidate1)
  assert.equal(first, candidate1)
  assert.equal(bus.Count('ws-1'), 1)

  // 2. 再次 acquire 传入 candidate2，first-wins 依然返回 candidate1，refcount = 2
  const second = bus.Acquire('ws-1', candidate2)
  assert.equal(second, candidate1, 'first-wins: 必须返回首次注册的实例')
  assert.notEqual(second, candidate2)
  assert.equal(bus.Count('ws-1'), 2)

  // 3. 尝试 release 非同一实例 candidate2：不减计数
  const fakeRelease = bus.Release('ws-1', candidate2)
  assert.equal(fakeRelease, false, '非 ReferenceEquals 实例不能释放')
  assert.equal(bus.Count('ws-1'), 2)

  // 4. 正确 release candidate1 第一次：减计数至 1，不删除
  const r1 = bus.Release('ws-1', candidate1)
  assert.equal(r1, false)
  assert.equal(bus.Count('ws-1'), 1)

  // 5. 正确 release candidate1 第二次：计数至 0，成功删除
  const r2 = bus.Release('ws-1', candidate1)
  assert.equal(r2, true)
  assert.equal(bus.Count('ws-1'), 0)

  // 6. 再次 release 已不存在的 key
  assert.equal(bus.Release('ws-1', candidate1), false)
})
