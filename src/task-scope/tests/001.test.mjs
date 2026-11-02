import test from 'node:test'
import assert from 'node:assert/strict'
import { TaskScope } from '../../../dist/task-scope/TaskScope.js'

const deferred = () => Promise.withResolvers()
const nextTurn = () => new Promise(resolve => setImmediate(resolve))
const ok = { ok: true }

test('run/background 同步启动并登记，close 同步关闭接纳', async () => {
  const scope = new TaskScope()
  const left = deferred()
  const right = deferred()
  const started = []
  const running = scope.run(() => { started.push('run'); return left.promise })
  const background = scope.background(() => { started.push('background'); return right.promise })
  assert.deepEqual(started, ['run', 'background'])
  const closing = scope.close()
  let closed = false
  closing.then(() => { closed = true })
  await scope.run(async () => { started.push('late run') })
  await scope.background(async () => { started.push('late background') })
  assert.deepEqual(started, ['run', 'background'])
  assert.equal(closed, false)
  left.resolve()
  await running
  assert.equal(closed, false)
  right.resolve()
  await background
  assert.deepEqual(await closing, ok)
})

test('同步 throw 与异步 reject 都结束 run，原错误外抛而不记后台槽', async () => {
  for (const asynchronous of [false, true]) {
    const scope = new TaskScope()
    const cause = new Error('foreground failure')
    let started = false
    let running
    assert.doesNotThrow(() => {
      running = scope.run(() => { started = true; if (asynchronous) return Promise.reject(cause); throw cause })
    })
    assert.equal(started, true)
    await assert.rejects(running, error => error === cause)
    assert.deepEqual(await scope.waitIdle(), ok)
    assert.deepEqual(await scope.close(), ok)
  }
})

test('background 观察同步/异步失败，返回任务正常完成并保留身份', async () => {
  for (const asynchronous of [false, true]) {
    const scope = new TaskScope()
    const cause = new Error('background failure')
    let started = false
    const tracked = scope.background(() => { started = true; if (asynchronous) return Promise.reject(cause); throw cause })
    assert.equal(started, true)
    assert.equal(await tracked, undefined)
    const result = await scope.waitIdle()
    assert.equal(result.ok, false)
    assert.equal(result.error, cause)
    assert.equal((await scope.close()).error, cause)
  }
})

test('最后观察的后台失败覆盖前错，与提交顺序无关', async () => {
  const scope = new TaskScope()
  const first = deferred()
  const second = deferred()
  const a = new Error('first admitted, last observed')
  const b = new Error('second admitted, first observed')
  const left = scope.background(() => first.promise)
  const right = scope.background(() => second.promise)
  second.reject(b)
  await right
  const waiting = scope.waitIdle()
  first.reject(a)
  await left
  assert.equal((await waiting).error, a)
  assert.equal((await scope.waitIdle()).error, a)
  await scope.background(async () => {})
  assert.equal((await scope.waitIdle()).error, a)
  const c = { failure: 'next epoch' }
  await scope.background(() => Promise.reject(c))
  assert.equal((await scope.close()).error, c)
})

test('前台失败不覆盖已有后台失败', async () => {
  const scope = new TaskScope()
  const background = new Error('background')
  const foreground = new Error('foreground')
  await scope.background(() => Promise.reject(background))
  await assert.rejects(scope.run(() => Promise.reject(foreground)), error => error === foreground)
  assert.equal((await scope.close()).error, background)
})

test('undefined/null 等不真值拒绝仍是失败，读取不消费错误', async () => {
  for (const cause of [undefined, null, false, 0, '']) {
    const scope = new TaskScope()
    await scope.background(() => Promise.reject(cause))
    for (const result of [await scope.waitIdle(), await scope.waitIdle(), await scope.close()]) {
      assert.equal(result.ok, false)
      assert.equal(Object.hasOwn(result, 'error'), true)
      assert.equal(result.error, cause)
    }
  }
})

test('多个观察等待者等待当期归零，下一忙期不重挂已完成等待', async () => {
  const scope = new TaskScope()
  const first = deferred()
  const running = scope.run(() => first.promise)
  const observers = [scope.waitIdle(), scope.waitIdle()]
  let settled = 0
  for (const observer of observers) observer.then(() => { settled++ })
  await nextTurn()
  assert.equal(settled, 0)
  first.resolve()
  await running
  assert.deepEqual(await Promise.all(observers), [ok, ok])
  assert.equal(settled, 2)
  const next = deferred()
  const second = scope.background(() => next.promise)
  const nextIdle = scope.waitIdle()
  let nextSettled = false
  nextIdle.then(() => { nextSettled = true })
  try {
    await Promise.all(observers)
    assert.equal(nextSettled, false)
    next.resolve()
    await second
    assert.deepEqual(await nextIdle, ok)
  } finally { next.resolve(); await second }
})

test('waitIdle 不关入口，close 永久关闭且重复等待都能完成', async () => {
  const scope = new TaskScope()
  assert.deepEqual(await scope.waitIdle(), ok)
  const gate = deferred()
  let calls = 0
  const running = scope.background(() => { calls++; return gate.promise })
  const first = scope.close()
  const second = scope.close()
  await scope.run(async () => { calls++ })
  assert.equal(calls, 1)
  gate.resolve()
  await running
  assert.deepEqual(await Promise.all([first, second]), [ok, ok])
  await scope.background(async () => { calls++ })
  assert.equal(calls, 1)
  assert.deepEqual(await scope.close(), ok)
})

test('嵌套工作关闭前接纳，关闭后忽略且排空仍等待已接纳子工作', async () => {
  const scope = new TaskScope()
  const child = deferred()
  const parent = deferred()
  let calls = 0
  let nested
  const running = scope.run(() => {
    nested = scope.background(() => { calls++; return child.promise })
    return parent.promise.then(() => scope.background(async () => { calls++ }))
  })
  assert.equal(calls, 1)
  const closing = scope.close()
  let closed = false
  closing.then(() => { closed = true })
  try {
    parent.resolve()
    await running
    assert.equal(calls, 1)
    assert.equal(closed, false)
    child.resolve()
    await nested
    assert.deepEqual(await closing, ok)
  } finally { parent.resolve(); child.resolve(); await Promise.all([running, nested]) }
})

test('等待结果读取结束时的错误槽，而非调用时快照', async () => {
  const scope = new TaskScope()
  const oldFailure = new Error('old')
  await scope.background(() => Promise.reject(oldFailure))
  const gate = deferred()
  const current = scope.background(() => gate.promise)
  const waiting = scope.waitIdle()
  const closing = scope.close()
  const newFailure = new Error('new')
  gate.reject(newFailure)
  await current
  assert.equal((await waiting).error, newFailure)
  assert.equal((await closing).error, newFailure)
})

test('归零时先释放观察等待，再释放关闭等待，保持旧释放次序', async () => {
  const scope = new TaskScope()
  const gate = deferred()
  const running = scope.run(() => gate.promise)
  const order = []
  const closing = scope.close().then(result => { order.push('close'); return result })
  const observed = scope.waitIdle().then(result => { order.push('idle'); return result })
  gate.resolve()
  await running
  assert.deepEqual(await Promise.all([closing, observed]), [ok, ok])
  assert.deepEqual(order, ['idle', 'close'])
})

test('回调可以同步 close 自身而不等待自身，后续回调不再启动', async () => {
  const scope = new TaskScope()
  let closing
  const running = scope.run(() => { closing = scope.close(); return Promise.resolve() })
  let late = false
  await scope.background(async () => { late = true })
  await running
  assert.deepEqual(await closing, ok)
  assert.equal(late, false)
})

test('实例隔离且不公开可修改接纳/计数/错误槽', async () => {
  const left = new TaskScope()
  const right = new TaskScope()
  const cause = new Error('left only')
  await left.background(() => Promise.reject(cause))
  assert.equal((await left.close()).error, cause)
  let called = false
  await right.run(async () => { called = true })
  assert.equal(called, true)
  assert.deepEqual(await right.waitIdle(), ok)
  assert.deepEqual(Object.keys(left), [])
})
