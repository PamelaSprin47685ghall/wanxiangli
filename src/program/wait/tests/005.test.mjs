import test from 'node:test'
import assert from 'node:assert/strict'
import { Wait } from '../../../../dist/program/Program.js'

const mailbox = () => Wait.completionMailbox()

test('WHAT[CAUSAL-WAIT-005] a waiter stays suspended until a real event wakes it', async () => {
  const box = mailbox()
  let woke = false
  const waking = box.waitForWake().then(reason => { woke = true; return reason })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(woke, false)

  box.pulseAgent('agent-1')
  assert.equal(await waking, 'CompletionMayBeAvailable')
})

test('WHAT[CAUSAL-WAIT-005] both channels wake waiters and keep their payloads drainable', async () => {
  const box = mailbox()
  box.pulseAgent('agent-a')
  box.pulseAgent('agent-b')
  box.publishPty({ pty: 'p1', outcome: 'Exited' })

  assert.equal(await box.waitForWake(), 'CompletionMayBeAvailable')
  assert.deepEqual(box.drainAgents(10), ['agent-a', 'agent-b'])
  assert.deepEqual(box.drainPtys(10), [{ pty: 'p1', outcome: 'Exited' }])
  assert.equal(box.pendingCount(), 0)
})

test('WHAT[CAUSAL-WAIT-005] a queued signal is visible without waiting first', async () => {
  const box = mailbox()
  box.publishPty('pty-1')
  assert.equal(box.pendingPtyCount(), 1)
  assert.equal(await box.waitForWake(), 'CompletionMayBeAvailable')
})

test('WHAT[CAUSAL-WAIT-005] drain is bounded and leaves the remainder queued', () => {
  const box = mailbox()
  box.pulseAgent('a')
  box.pulseAgent('b')
  box.pulseAgent('c')
  assert.deepEqual(box.drainAgents(2), ['a', 'b'])
  assert.equal(box.pendingCount(), 1)
  assert.deepEqual(box.drainAgents(0), [])
})
