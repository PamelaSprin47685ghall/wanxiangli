import test from 'node:test'
import assert from 'node:assert/strict'
import { LargeGate, largeGate } from '../../../dist/runtime/Runtime.js'

test('SPEC[large-gate-1] initial getCount() is 1, 0 after acquire, 1 after release', async () => {
  const gate = new LargeGate()
  assert.equal(gate.getCount(), 1)
  assert.equal(gate.tryAcquire(), true)
  assert.equal(gate.getCount(), 0)
  assert.equal(gate.tryAcquire(), false)

  gate.release()
  assert.equal(gate.getCount(), 1)
  assert.equal(gate.tryAcquire(), true)
  assert.equal(gate.getCount(), 0)
  gate.release()
  assert.equal(gate.getCount(), 1)
})

test('SPEC[large-gate-2] FIFO queueing and sequential wakeup', async () => {
  const gate = new LargeGate()
  assert.equal(gate.tryAcquire(), true)

  const events = []
  gate.enqueue(() => {
    events.push('waiter1')
  })
  gate.enqueue(() => {
    events.push('waiter2')
  })
  gate.enqueue(() => {
    events.push('waiter3')
  })

  // First release pumps waiter1
  gate.release()
  assert.deepEqual(events, ['waiter1'])
  assert.equal(gate.getCount(), 0)

  // Second release pumps waiter2
  gate.release()
  assert.deepEqual(events, ['waiter1', 'waiter2'])
  assert.equal(gate.getCount(), 0)

  // Third release pumps waiter3
  gate.release()
  assert.deepEqual(events, ['waiter1', 'waiter2', 'waiter3'])
  assert.equal(gate.getCount(), 0)

  // Fourth release, queue is empty, so gate is unheld
  gate.release()
  assert.equal(gate.getCount(), 1)
})

test('SPEC[large-gate-3] cancelled waiters at head or middle are skipped without losing permit', async () => {
  const gate = new LargeGate()
  assert.equal(gate.tryAcquire(), true)

  const events = []
  const cancel1 = gate.enqueue(() => {
    events.push('waiter1')
  })
  const cancel2 = gate.enqueue(() => {
    events.push('waiter2')
  })
  const cancel3 = gate.enqueue(() => {
    events.push('waiter3')
  })

  // Cancel waiter1 (head) and waiter2 (middle)
  cancel1()
  cancel2()

  // On release, waiter1 & waiter2 are skipped, waiter3 is granted
  gate.release()
  assert.deepEqual(events, ['waiter3'])
  assert.equal(gate.getCount(), 0)

  gate.release()
  assert.equal(gate.getCount(), 1)
})

test('SPEC[large-gate-4] acquire with AbortSignal rejects and does not hold gate', async () => {
  const gate = new LargeGate()
  const ac = new AbortController()
  ac.abort()

  await assert.rejects(
    async () => {
      await gate.acquire(ac.signal)
    },
    /aborted/
  )
  assert.equal(gate.getCount(), 1)
  assert.equal(gate.tryAcquire(), true)
  gate.release()
})

test('SPEC[large-gate-5] acquire with in-flight abort removes waiter and skips', async () => {
  const gate = new LargeGate()
  assert.equal(gate.tryAcquire(), true)

  const ac = new AbortController()
  const p1 = gate.acquire(ac.signal)

  let p2Granted = false
  const p2 = gate.acquire().then(() => {
    p2Granted = true
  })

  // Abort p1 while waiting
  ac.abort()
  await assert.rejects(p1, /aborted/)

  assert.equal(p2Granted, false)
  // Releasing the gate should skip p1 and grant p2
  gate.release()
  await p2
  assert.equal(p2Granted, true)
  assert.equal(gate.getCount(), 0)

  gate.release()
  assert.equal(gate.getCount(), 1)
})

test('SPEC[large-gate-6] independent LargeGate instance and global largeGate are isolated', async () => {
  const custom = new LargeGate()
  assert.equal(custom.getCount(), 1)
  assert.equal(largeGate.getCount(), 1)

  assert.equal(custom.tryAcquire(), true)
  assert.equal(custom.getCount(), 0)
  assert.equal(largeGate.getCount(), 1)

  custom.release()
  assert.equal(custom.getCount(), 1)
  assert.equal(largeGate.getCount(), 1)
})
