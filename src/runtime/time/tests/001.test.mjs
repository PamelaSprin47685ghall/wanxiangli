import test from 'node:test'
import assert from 'node:assert/strict'
import { Time } from '../../../../dist/runtime/Runtime.js'

test('WHAT[TIME-CAPABILITY-001] timer delay resolves after the requested milliseconds', async () => {
  const timer = Time.timerTask(30)
  const started = Date.now()
  await timer
  assert.ok(Date.now() - started >= 25)
})

test('WHAT[TIME-CAPABILITY-001] cancel leaves the delay permanently pending', async () => {
  const port = Time.nodeTimerPort()
  const handle = port.Delay(20)
  handle.Cancel()
  let fired = false
  handle.Delay.then(() => { fired = true })
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(fired, false)
})

test('WHAT[TIME-CAPABILITY-001] cancel and dispose are idempotent', async () => {
  const port = Time.nodeTimerPort()
  const handle = port.Delay(20)
  handle.Cancel()
  handle.Cancel()
  port.Dispose()
  port.Dispose()
  await new Promise(resolve => setTimeout(resolve, 50))
})

test('WHAT[TIME-CAPABILITY-001] cancelling one handle never steals another waiter', async () => {
  const port = Time.nodeTimerPort()
  const a = port.Delay(20)
  const b = port.Delay(20)
  a.Cancel()
  let bFired = false
  b.Delay.then(() => { bFired = true })
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(bFired, true)
})

test('WHAT[TIME-CAPABILITY-001] virtual port: cancelled handle never fires after advancing', async () => {
  const virtual = Time.virtualTimerPort()
  const a = virtual.port.Delay(50)
  const b = virtual.port.Delay(50)
  a.Cancel()
  virtual.advance(49)
  await Promise.resolve()
  virtual.advance(1)
  await Promise.resolve()
  let aFired = false
  a.Delay.then(() => { aFired = true })
  await Promise.resolve()
  assert.equal(aFired, false)
  await b.Delay
})
