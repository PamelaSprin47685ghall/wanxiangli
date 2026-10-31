import assert from 'node:assert/strict'
import { KeyedSerial } from 'wanxiangli/keyed-serial'

const queue = new KeyedSerial()
const started = Promise.withResolvers()
const gate = Promise.withResolvers()
const order = []
const value = { answer: 42 }
const first = queue.run('session', async () => {
  order.push('first')
  started.resolve()
  await gate.promise
  return value
})
const second = queue.run('session', async () => { order.push('second'); return 'second' })
try {
  assert.deepEqual(order, [])
  await started.promise
  assert.deepEqual(order, ['first'])
  gate.resolve()
  assert.equal(await first, value)
  assert.equal(await second, 'second')
  assert.deepEqual(order, ['first', 'second'])
} finally {
  gate.resolve()
  await Promise.allSettled([first, second])
}
const error = new Error('consumer failure')
const failed = queue.run('session', () => { throw error })
const rejected = assert.rejects(failed, actual => { assert.equal(actual, error); return true })
const after = queue.run('session', async () => 'after failure')
assert.equal(await after, 'after failure')
await rejected
console.log('keyed-serial consumer passed')
