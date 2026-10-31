import test from 'node:test'
import assert from 'node:assert/strict'
import { KeyedSerial } from '../../../dist/keyed-serial/KeyedSerial.js'

const deferred = () => Promise.withResolvers()
const checkpoint = () => new Promise(setImmediate)

test('同 key 的多次调用按 FIFO 开始，第一次 action 也异步启动', { timeout: 5000 }, async () => {
  const queue = new KeyedSerial()
  const gates = [deferred(), deferred(), deferred()]
  const starts = [deferred(), deferred(), deferred()]
  const order = []
  const jobs = gates.map((gate, index) => queue.run('session', async () => {
    order.push(index)
    starts[index].resolve()
    await gate.promise
    return index * 10
  }))
  try {
    assert.deepEqual(order, [])
    for (const index of [0, 1, 2]) {
      await starts[index].promise
      assert.deepEqual(order, Array.from({ length: index + 1 }, (_, n) => n))
      gates[index].resolve()
    }
    assert.deepEqual(await Promise.all(jobs), [0, 10, 20])
  } finally {
    for (const gate of gates) gate.resolve()
    await Promise.allSettled(jobs)
  }
})

test('登记队尾在返回前完成，action 内追加的工作不能越过已登记的后继', { timeout: 5000 }, async () => {
  const queue = new KeyedSerial()
  const order = []
  const jobs = []
  let nested
  jobs.push(queue.run('session', () => {
    order.push('A')
    nested = queue.run('session', async () => { order.push('C'); return 'C' })
    jobs.push(nested)
    return Promise.resolve('A')
  }))
  jobs.push(queue.run('session', async () => { order.push('B'); return 'B' }))
  try {
    assert.deepEqual(order, [])
    assert.deepEqual(await Promise.all(jobs), ['A', 'B'])
    assert.equal(await nested, 'C')
    assert.deepEqual(order, ['A', 'B', 'C'])
  } finally {
    await Promise.allSettled(jobs)
  }
})

test('不同 key 独立推进，不因一个尚未结清的 action 阻塞', { timeout: 5000 }, async () => {
  const queue = new KeyedSerial()
  const started = deferred()
  const blocked = deferred()
  let firstEnded = false
  const first = queue.run('__proto__', async () => {
    started.resolve()
    await blocked.promise
    firstEnded = true
    return 'first'
  })
  const second = queue.run('__proto__ ', async () => 'second')
  const empty = queue.run('', async () => 'empty')
  try {
    await started.promise
    assert.equal(await second, 'second')
    assert.equal(await empty, 'empty')
    assert.equal(firstEnded, false)
  } finally {
    blocked.resolve()
    await Promise.allSettled([first, second, empty])
  }
})

test('不同实例的相同 key 互不阻塞', { timeout: 5000 }, async () => {
  const firstQueue = new KeyedSerial()
  const secondQueue = new KeyedSerial()
  const gate = deferred()
  const firstStarted = deferred()
  const first = firstQueue.run('same', async () => { firstStarted.resolve(); await gate.promise; return 1 })
  const second = secondQueue.run('same', async () => 2)
  try {
    await firstStarted.promise
    assert.equal(await second, 2)
  } finally {
    gate.resolve()
    await Promise.allSettled([first, second])
  }
})

for (const mode of ['同步抛错', '异步拒绝']) {
  test(`${mode}返回原错误并放行后继，队列可继续使用`, { timeout: 5000 }, async () => {
    const queue = new KeyedSerial()
    const error = new Error(mode)
    const gate = deferred()
    const started = deferred()
    const value = { answer: 42 }
    const first = queue.run('session', () => {
      started.resolve()
      if (mode === '同步抛错') throw error
      return gate.promise.then(() => { throw error })
    })
    const rejected = assert.rejects(first, actual => { assert.equal(actual, error); return true })
    const successor = queue.run('session', async () => value)
    try {
      await started.promise
      gate.resolve()
      assert.equal(await successor, value)
      await rejected
      assert.equal(await queue.run('session', async () => 'fresh'), 'fresh')
    } finally {
      gate.resolve()
      await Promise.allSettled([first, rejected, successor])
    }
  })
}

test('前项完成不能删掉已登记后项的尾，后加工作仍排在后项之后', { timeout: 5000 }, async () => {
  const queue = new KeyedSerial()
  const firstGate = deferred()
  const secondGate = deferred()
  const firstStarted = deferred()
  const secondStarted = deferred()
  const order = []
  const first = queue.run('session', async () => {
    order.push('A')
    firstStarted.resolve()
    await firstGate.promise
    return 'A'
  })
  const second = queue.run('session', async () => {
    order.push('B')
    secondStarted.resolve()
    await secondGate.promise
    return 'B'
  })
  const jobs = [first, second]
  try {
    await firstStarted.promise
    firstGate.resolve()
    assert.equal(await first, 'A')
    await secondStarted.promise
    const third = queue.run('session', async () => { order.push('C'); return 'C' })
    jobs.push(third)
    await checkpoint()
    assert.deepEqual(order, ['A', 'B'])
    secondGate.resolve()
    assert.deepEqual(await Promise.all(jobs), ['A', 'B', 'C'])
    assert.deepEqual(order, ['A', 'B', 'C'])
  } finally {
    firstGate.resolve()
    secondGate.resolve()
    await Promise.allSettled(jobs)
  }
})

test('后继不等待调用者消费前项结果；同一 action 每次调用都执行', { timeout: 5000 }, async () => {
  const queue = new KeyedSerial()
  let calls = 0
  const value = { preserved: true }
  const action = async () => { calls++; return value }
  const first = queue.run('session', action)
  const second = queue.run('session', action)
  try {
    assert.equal(await second, value)
    assert.equal(calls, 2)
    assert.equal(await first, value)
  } finally {
    await Promise.allSettled([first, second])
  }
})

test('结果原身份返回，不把 null、undefined 或 bigint 包装成协议对象', async () => {
  const queue = new KeyedSerial()
  const values = [{ object: true }, null, undefined, 9223372036854775807n]
  const jobs = values.map(value => queue.run('session', async () => value))
  const results = await Promise.all(jobs)
  for (let index = 0; index < values.length; index++) assert.equal(results[index], values[index])
})
