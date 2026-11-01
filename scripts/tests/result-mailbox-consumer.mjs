import assert from 'node:assert/strict'
import { ResultMailbox } from 'wanxiangli/result-mailbox'

const mailbox = new ResultMailbox()
mailbox.start()
const interrupt = Promise.withResolvers()
const reason = { input: 'new message' }
const first = mailbox.beginJoin(8, interrupt.promise)
assert.equal(first.kind, 'pending')
interrupt.resolve(reason)
const interrupted = await first.completion
assert.equal(interrupted.kind, 'interrupted')
assert.equal(interrupted.reason, reason)
assert.equal(mailbox.hasActive, true)
const second = mailbox.beginJoin(8, new Promise(() => {}))
const value = { completed: 'same object' }
mailbox.publish(value)
const delivered = await second.completion
assert.equal(delivered.kind, 'items')
assert.equal(delivered.items[0], value)
assert.equal(mailbox.pendingCount, 0)
assert.equal(mailbox.hasActive, false)

mailbox.start()
const rejected = Promise.withResolvers()
const failedJoin = mailbox.beginJoin(8, rejected.promise)
const cause = new Error('consumer interrupt rejected')
const observed = assert.rejects(failedJoin.completion, error => error === cause)
rejected.reject(cause)
await observed
const afterFailure = mailbox.beginJoin(8, new Promise(() => {}))
mailbox.publish(value)
assert.equal((await afterFailure.completion).items[0], value)
assert.deepEqual(mailbox.beginJoin(8, Promise.reject(new Error('ignored idle interrupt'))), { kind: 'ready', result: { kind: 'empty' } })
await new Promise(resolve => setImmediate(resolve))
console.log('result-mailbox consumer passed')
