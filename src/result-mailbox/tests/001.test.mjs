import test from 'node:test'
import assert from 'node:assert/strict'
import { ResultMailbox } from '../../../dist/result-mailbox/ResultMailbox.js'

const deferred = () => Promise.withResolvers()
const never = () => new Promise(() => {})
const nextTurn = () => new Promise(resolve => setImmediate(resolve))
const items = values => ({ kind: 'items', items: values })
function completion(start) {
  return start.kind === 'ready' ? Promise.resolve(start.result) : start.completion
}
async function alreadyWoken(start) {
  const value = await Promise.race([
    completion(start).then(result => ({ done: true, result })),
    nextTurn().then(() => ({ done: false })),
  ])
  assert.equal(value.done, true, 'publish 必须唤醒当前 waiter，不能被遗留 waiter 吞掉')
  return value.result
}

test('FIFO 排空保留剩余量和对象身份，不设产品批量上限', () => {
  const mailbox = new ResultMailbox()
  const values = Array.from({ length: 40 }, (_, index) => ({ index }))
  for (const value of values) mailbox.publish(value)
  assert.equal(mailbox.pendingCount, 40)
  const first = mailbox.drain(2)
  assert.deepEqual(first, values.slice(0, 2))
  assert.equal(first[0], values[0])
  assert.equal(mailbox.pendingCount, 38)
  assert.deepEqual(mailbox.drain(100), values.slice(2))
  assert.deepEqual(mailbox.drain(1), [])
  assert.equal(mailbox.pendingCount, 0)
})

test('start/publish 管理活动数，允许没有 start 的 publish', () => {
  const mailbox = new ResultMailbox()
  assert.equal(mailbox.hasActive, false)
  mailbox.start(); mailbox.start()
  mailbox.publish(undefined)
  assert.equal(mailbox.hasActive, true)
  mailbox.publish(null)
  assert.equal(mailbox.hasActive, false)
  mailbox.publish('extra')
  assert.equal(mailbox.hasActive, false)
  assert.deepEqual(mailbox.drain(3), [undefined, null, 'extra'])
  assert.throws(() => { mailbox.hasActive = true }, TypeError)
  assert.throws(() => { mailbox.pendingCount = 99 }, TypeError)
  assert.equal(Object.hasOwn(mailbox, 'waiters'), false)
})

test('ready 结果优先于已到达的普通中断；空闲 empty 不入队', () => {
  const mailbox = new ResultMailbox()
  const value = { answer: 42 }
  mailbox.publish(value)
  const ready = mailbox.beginJoin(8, Promise.resolve({ reason: 'input' }))
  assert.equal(ready.kind, 'ready')
  assert.equal(ready.result.items[0], value)
  assert.deepEqual(mailbox.beginJoin(8, Promise.resolve('input')), { kind: 'ready', result: { kind: 'empty' } })
  assert.equal(mailbox.pendingCount, 0)
})

test('每次 publish 只唤醒一个等待者', async () => {
  const mailbox = new ResultMailbox()
  mailbox.start(); mailbox.start()
  const first = mailbox.beginJoin(1, never())
  const interrupt = deferred()
  const second = mailbox.beginJoin(1, interrupt.promise)
  let secondFinished = false
  second.completion.then(() => { secondFinished = true })
  try {
    mailbox.publish('one')
    assert.deepEqual(await first.completion, items(['one']))
    await nextTurn()
    assert.equal(secondFinished, false)
    mailbox.publish('two')
    assert.deepEqual(await alreadyWoken(second), items(['two']))
  } finally { interrupt.resolve('cleanup'); await second.completion }
})

test('普通中断只结束本次等待，下一次仍收到同一完成对象', async () => {
  const mailbox = new ResultMailbox()
  mailbox.start()
  const interrupt = deferred()
  const reason = { source: 'input' }
  const first = mailbox.beginJoin(4, interrupt.promise)
  assert.equal(first.kind, 'pending')
  interrupt.resolve(reason)
  const result = await first.completion
  assert.equal(result.reason, reason)
  assert.equal(mailbox.hasActive, true)
  const nextInterrupt = deferred()
  const second = mailbox.beginJoin(4, nextInterrupt.promise)
  const value = { result: 'done' }
  try {
    mailbox.publish(value)
    assert.equal((await alreadyWoken(second)).items[0], value)
    assert.equal(mailbox.pendingCount, 0)
    assert.equal(mailbox.hasActive, false)
  } finally { nextInterrupt.resolve('cleanup'); await second.completion }
})

test('三种同轮竞态都先交回已到达的结果', async () => {
  for (const order of ['queued-before-join', 'publish-then-interrupt', 'interrupt-then-publish']) {
    const mailbox = new ResultMailbox()
    mailbox.start()
    const interrupt = deferred()
    const value = { order }
    let join
    if (order === 'queued-before-join') {
      mailbox.publish(value)
      interrupt.resolve('input')
      join = mailbox.beginJoin(8, interrupt.promise)
    } else {
      join = mailbox.beginJoin(8, interrupt.promise)
      if (order === 'publish-then-interrupt') { mailbox.publish(value); interrupt.resolve('input') }
      else { interrupt.resolve('input'); mailbox.publish(value) }
    }
    assert.equal((await completion(join)).items[0], value, order)
    assert.equal(mailbox.pendingCount, 0)
  }
})

test('跨微任务到达且在 completion 结算前的结果仍优先', async () => {
  for (const depth of [1, 2, 3]) {
    const mailbox = new ResultMailbox()
    mailbox.start()
    const interrupt = deferred()
    const join = mailbox.beginJoin(1, interrupt.promise)
    interrupt.resolve('input')
    const publication = (async () => {
      for (let step = 0; step < depth; step++) await Promise.resolve()
      mailbox.publish(depth)
    })()
    assert.deepEqual(await join.completion, items([depth]))
    await publication
  }
})

test('interrupt 后 redrain 有结果也清理自己的未唤醒 waiter', async () => {
  const mailbox = new ResultMailbox()
  mailbox.start(); mailbox.start()
  const first = mailbox.beginJoin(1, never())
  const interrupt = deferred()
  const second = mailbox.beginJoin(1, interrupt.promise)
  interrupt.resolve('input')
  mailbox.publish('racing')
  assert.deepEqual(await second.completion, items(['racing']))
  assert.deepEqual(await first.completion, { kind: 'empty' })
  const cleanup = deferred()
  const third = mailbox.beginJoin(1, cleanup.promise)
  try {
    mailbox.publish('later')
    assert.deepEqual(await alreadyWoken(third), items(['later']))
  } finally { cleanup.resolve('cleanup'); await third.completion }
})

test('interrupt 拒绝保留错误身份，下一次等待不被旧 waiter 吞唤醒', async () => {
  for (const cause of [new Error('interrupt rejected'), { failure: 'opaque rejection' }]) {
    const mailbox = new ResultMailbox()
    mailbox.start()
    const interrupt = deferred()
    const first = mailbox.beginJoin(8, interrupt.promise)
    const rejected = assert.rejects(first.completion, error => error === cause)
    interrupt.reject(cause)
    await rejected
    assert.equal(mailbox.hasActive, true)
    const cleanup = deferred()
    const next = mailbox.beginJoin(8, cleanup.promise)
    const value = { after: cause }
    try {
      mailbox.publish(value)
      assert.equal((await alreadyWoken(next)).items[0], value)
    } finally { cleanup.resolve('cleanup'); await next.completion }
  }
})

test('拒绝不会吞掉同轮发布的结果，也不把异常改成普通中断', async () => {
  const mailbox = new ResultMailbox()
  mailbox.start()
  const interrupt = deferred()
  const join = mailbox.beginJoin(8, interrupt.promise)
  const cause = new Error('rejected before publish')
  const rejected = assert.rejects(join.completion, error => error === cause)
  interrupt.reject(cause)
  mailbox.publish('kept')
  await rejected
  assert.deepEqual(mailbox.drain(8), ['kept'])
})

test('ready 快路径处理已拒绝 interrupt 而不改变结果或触发 unhandled', async () => {
  const mailbox = new ResultMailbox()
  const empty = mailbox.beginJoin(1, Promise.reject(new Error('ignored idle interrupt')))
  assert.deepEqual(empty, { kind: 'ready', result: { kind: 'empty' } })
  mailbox.publish('ready')
  const ready = mailbox.beginJoin(1, Promise.reject(new Error('ignored ready interrupt')))
  assert.deepEqual(ready, { kind: 'ready', result: items(['ready']) })
  await nextTurn()
})

test('零和负容量保留旧 empty/等待语义，不强取结果', async () => {
  for (const cap of [0, -3]) {
    const mailbox = new ResultMailbox()
    mailbox.publish('queued')
    assert.deepEqual(mailbox.drain(cap), [])
    assert.deepEqual(mailbox.beginJoin(cap, never()), { kind: 'ready', result: { kind: 'empty' } })
    assert.equal(mailbox.pendingCount, 1)
    mailbox.start()
    const queued = mailbox.beginJoin(cap, Promise.resolve('input'))
    assert.equal(queued.kind, 'pending')
    assert.deepEqual(await queued.completion, { kind: 'empty' })
    assert.deepEqual(mailbox.drain(1), ['queued'])
    const interrupt = deferred()
    const empty = mailbox.beginJoin(cap, interrupt.promise)
    assert.equal(empty.kind, 'pending')
    interrupt.resolve('input')
    assert.deepEqual(await empty.completion, { kind: 'interrupted', reason: 'input' })
  }
})

test('不同实例的状态与等待相互独立', async () => {
  const left = new ResultMailbox()
  const right = new ResultMailbox()
  left.start(); right.start()
  const interrupt = deferred()
  const pending = right.beginJoin(1, interrupt.promise)
  left.publish('left')
  assert.deepEqual(left.drain(1), ['left'])
  assert.equal(right.pendingCount, 0)
  assert.equal(right.hasActive, true)
  interrupt.resolve('right input')
  assert.deepEqual(await pending.completion, { kind: 'interrupted', reason: 'right input' })
})
