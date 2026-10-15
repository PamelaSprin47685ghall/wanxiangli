import test from 'node:test'
import assert from 'node:assert/strict'
import { Time } from '../../../dist/time/Time.js'

test('WHAT[TIME-CAPABILITY-003] a virtual timer does not fire before its due time', async () => {
  const virtual = Time.virtualTimerPort()
  const handle = virtual.port.Delay(100)
  let fired = false
  handle.Delay.then(() => { fired = true })

  virtual.advance(99)
  await Promise.resolve()
  assert.equal(fired, false)

  virtual.advance(1)
  await handle.Delay
  assert.equal(fired, true)
})

test('WHAT[TIME-CAPABILITY-003] due timers fire in registration order within one advance', async () => {
  const virtual = Time.virtualTimerPort()
  const order = []
  const first = virtual.port.Delay(50)
  const second = virtual.port.Delay(50)
  first.Delay.then(() => order.push('first'))
  second.Delay.then(() => order.push('second'))

  virtual.advance(50)
  await Promise.all([first.Delay, second.Delay])
  assert.deepEqual(order, ['first', 'second'])
})

test('WHAT[TIME-CAPABILITY-003] the virtual clock advances deterministically and can be set', () => {
  const virtual = Time.virtualClockPort()
  const before = Number(virtual.port.UtcNow())
  virtual.advanceMs(1500)
  const after = Number(virtual.port.UtcNow())
  assert.equal(after - before, 1500)

  virtual.set('2020-01-01T00:00:00.000Z')
  assert.equal(Number(virtual.port.UtcNow()), Date.parse('2020-01-01T00:00:00.000Z'))
})

test('WHAT[TIME-CAPABILITY-003] virtual timer instances are independent', () => {
  const one = Time.virtualTimerPort()
  const two = Time.virtualTimerPort()
  one.advance(100)
  assert.equal(one.nowMs(), 100)
  assert.equal(two.nowMs(), 0)
})

test('WHAT[TIME-CAPABILITY-003] a disposed virtual port no longer fires', async () => {
  const virtual = Time.virtualTimerPort()
  const handle = virtual.port.Delay(10)
  virtual.port.Dispose()
  virtual.advance(10)
  let fired = false
  handle.Delay.then(() => { fired = true })
  await Promise.resolve()
  assert.equal(fired, false)
})
