import assert from 'node:assert/strict'
import { TaskScope } from 'wanxiangli/task-scope'

const scope = new TaskScope()
const left = Promise.withResolvers()
const right = Promise.withResolvers()
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
const cause = new Error('background rejected')
right.reject(cause)
await background
assert.equal(closed, false)
left.resolve()
await running
const result = await closing
assert.equal(result.ok, false)
assert.equal(result.error, cause)
assert.equal((await scope.close()).error, cause)

const unknown = new TaskScope()
await unknown.background(() => Promise.reject(undefined))
const opaqueFailure = await unknown.close()
assert.equal(opaqueFailure.ok, false)
assert.equal(Object.hasOwn(opaqueFailure, 'error'), true)
assert.equal(opaqueFailure.error, undefined)
console.log('task-scope consumer passed')
