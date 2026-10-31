import test from 'node:test'
import assert from 'node:assert/strict'
import { mapBounded } from '../../../dist/bounded-map/BoundedMap.js'

const deferred = () => Promise.withResolvers()
const checkpoint = () => new Promise(setImmediate)

test('结果跟随输入顺序，不跟随反序完成的任务', { timeout: 5000 }, async () => {
  const items = [1, 2, 3, 4, 5, 6]
  const gates = items.map(deferred)
  const started = deferred()
  let count = 0
  const result = mapBounded(6, async item => {
    if (++count === items.length) started.resolve()
    await gates[item - 1].promise
    return item * 10
  }, items)
  await started.promise
  for (const gate of gates.toReversed()) gate.resolve()
  assert.deepEqual(await result, [10, 20, 30, 40, 50, 60])
})

test('多波任务严格遵守限额并按原序归并', { timeout: 5000 }, async () => {
  const items = [0, 1, 2, 3, 4, 5]
  const gates = items.map(deferred)
  const starts = items.map(deferred)
  let active = 0
  let peak = 0
  const result = mapBounded(2, async item => {
    active++
    peak = Math.max(peak, active)
    starts[item].resolve()
    try {
      await gates[item].promise
      return `r${item}`
    } finally {
      active--
    }
  }, items)
  await Promise.all([starts[0].promise, starts[1].promise])
  assert.equal(peak, 2)
  for (const item of [1, 0, 3, 2, 5, 4]) {
    await starts[item].promise
    gates[item].resolve()
  }
  assert.deepEqual(await result, items.map(item => `r${item}`))
  assert.equal(peak, 2)
  assert.equal(active, 0)
})

test('限额为一时串行执行，限额大于任务数时照常工作', { timeout: 5000 }, async () => {
  const gates = [deferred(), deferred(), deferred()]
  const starts = [deferred(), deferred(), deferred()]
  const order = []
  const result = mapBounded(1, async item => {
    order.push(item)
    starts[item].resolve()
    await gates[item].promise
    return item
  }, [0, 1, 2])
  for (const item of [0, 1, 2]) {
    await starts[item].promise
    assert.deepEqual(order, Array.from({ length: item + 1 }, (_, n) => n))
    gates[item].resolve()
  }
  assert.deepEqual(await result, [0, 1, 2])
  assert.deepEqual(await mapBounded(100, async item => item + 1, [1, 2]), [2, 3])
})

test('并发调用分别拥有许可，不共享全局上限', { timeout: 5000 }, async () => {
  const gate = deferred()
  const started = deferred()
  let active = 0
  let peak = 0
  const action = async item => {
    active++
    peak = Math.max(peak, active)
    if (active === 4) started.resolve()
    try {
      await gate.promise
      return item
    } finally {
      active--
    }
  }
  const first = mapBounded(2, action, ['a', 'b'])
  const second = mapBounded(2, action, ['c', 'd'])
  await started.promise
  assert.equal(peak, 4)
  gate.resolve()
  assert.deepEqual(await Promise.all([first, second]), [['a', 'b'], ['c', 'd']])
  assert.equal(active, 0)
})

for (const mode of ['同步抛错', '异步拒绝']) {
  test(`${mode}提前返回原 Error，归还许可后排队兄弟继续`, { timeout: 5000 }, async () => {
    const error = new Error(mode)
    const failureGate = deferred()
    const siblingStarted = deferred()
    const siblingGate = deferred()
    const drained = deferred()
    const completed = []
    const result = mapBounded(1, item => {
      if (item === 1) {
        if (mode === '同步抛错') throw error
        return failureGate.promise.then(() => { throw error })
      }
      if (item === 2) {
        siblingStarted.resolve()
        return siblingGate.promise.then(() => { completed.push(item); return item })
      }
      completed.push(item)
      drained.resolve()
      return Promise.resolve(item)
    }, [1, 2, 3])
    const rejected = assert.rejects(result, actual => {
      assert.equal(actual, error)
      return true
    })
    failureGate.resolve()
    await rejected
    await siblingStarted.promise
    assert.deepEqual(completed, [])
    siblingGate.resolve()
    await drained.promise
    assert.deepEqual(completed, [2, 3])
    assert.deepEqual(await mapBounded(2, async item => item, [1, 2, 3]), [1, 2, 3])
  })
}

test('非法限额在启动任何 action 前拒绝，空输入也不绕过校验', async () => {
  let calls = 0
  const action = async item => { calls++; return item }
  for (const limit of [0, -1, -100, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
    for (const items of [[], [1, 2]]) {
      await assert.rejects(mapBounded(limit, action, items), /positive safe integer/)
    }
  }
  assert.equal(calls, 0)
  assert.deepEqual(await mapBounded(2, action, []), [])
  assert.deepEqual(await mapBounded(Number.MAX_SAFE_INTEGER, action, [1]), [1])
  assert.equal(calls, 1)
})

test('已取消的原生 signal 不启动 action，取消 reason 保留身份', async () => {
  const controller = new AbortController()
  const reason = new Error('cancel before queueing')
  controller.abort(reason)
  let calls = 0
  await assert.rejects(mapBounded(2, async item => { calls++; return item }, [1, 2], controller.signal), actual => {
    assert.equal(actual, reason)
    return true
  })
  assert.equal(calls, 0)
  assert.deepEqual(await mapBounded(2, async () => { throw new Error('unused') }, [], controller.signal), [])
  const custom = new AbortController()
  const customReason = { kind: 'caller-abort' }
  custom.abort(customReason)
  await assert.rejects(mapBounded(1, async () => { throw new Error('unused') }, [1], custom.signal), actual => {
    assert.equal(actual, customReason)
    return true
  })
  const defaultAbort = new AbortController()
  defaultAbort.abort()
  await assert.rejects(mapBounded(1, async () => { throw new Error('unused') }, [1], defaultAbort.signal), actual => {
    assert.equal(actual, defaultAbort.signal.reason)
    assert.equal(actual.name, 'AbortError')
    return true
  })
})

test('拿到许可后、执行 action 前再次观察取消', async () => {
  const controller = new AbortController()
  const reason = new Error('cancel after admission')
  const calls = []
  await assert.rejects(mapBounded(2, async item => {
    calls.push(item)
    controller.abort(reason)
    return item
  }, [1, 2, 3], controller.signal), actual => {
    assert.equal(actual, reason)
    return true
  })
  assert.deepEqual(calls, [1])
})

test('排队期间取消仍等到许可再拒绝，已运行任务自行结束', { timeout: 5000 }, async () => {
  const controller = new AbortController()
  const reason = new Error('cancel while queued')
  const started = deferred()
  const release = deferred()
  const calls = []
  const result = mapBounded(1, async item => {
    calls.push(item)
    started.resolve()
    await release.promise
    return item
  }, ['first', 'queued'], controller.signal)
  let settled = false
  const rejected = assert.rejects(result, actual => {
    settled = true
    assert.equal(actual, reason)
    return true
  })
  await started.promise
  controller.abort(reason)
  await checkpoint()
  assert.equal(settled, false)
  assert.deepEqual(calls, ['first'])
  release.resolve()
  await rejected
  assert.deepEqual(calls, ['first'])
})

test('action 接收给定的同一个 signal，省略时每调用创建一个 signal', async () => {
  const controller = new AbortController()
  const seen = []
  await mapBounded(2, async (item, signal) => { seen.push(signal); return item }, [1, 2], controller.signal)
  assert.deepEqual(seen, [controller.signal, controller.signal])
  const defaults = []
  await mapBounded(2, async (item, signal) => { defaults.push(signal); return item }, [1, 2])
  assert.ok(defaults[0] instanceof AbortSignal)
  assert.equal(defaults[0].aborted, false)
  assert.equal(defaults[0], defaults[1])
  await mapBounded(1, async (_item, signal) => { assert.notEqual(signal, defaults[0]) }, [1])
})

test('输入数组在调用时快照成员，工作项对象身份不深拷贝', { timeout: 5000 }, async () => {
  const first = { id: 'first' }
  const second = { id: 'second', value: 1 }
  const input = [first, second]
  const started = deferred()
  const gate = deferred()
  const seen = []
  const result = mapBounded(1, async item => {
    seen.push(item)
    if (item === first) {
      started.resolve()
      await gate.promise
    }
    return item
  }, input)
  await started.promise
  input[1] = { id: 'replacement' }
  input.push({ id: 'extra' })
  second.value = 2
  gate.resolve()
  const output = await result
  assert.deepEqual(seen, [first, second])
  assert.equal(output[0], first)
  assert.equal(output[1], second)
  assert.equal(output[1].value, 2)
})
