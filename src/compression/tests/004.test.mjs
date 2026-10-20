import test from 'node:test'
import assert from 'node:assert/strict'
import { Compression } from '../../../dist/compression/Compression.js'

const CheckpointSettlement = () => Compression().checkpoints()

const call = (session, callId) => ({ session, callId })
const terminal = (session, callId, status) => ({ session, callId, status })

test('SPEC[compression-004] only a completed terminal appends, exactly once', () => {
  const ledger = CheckpointSettlement()
  assert.equal(ledger.observe(terminal('s', 'c', 'completed')), 'append')
  assert.equal(ledger.observe(terminal('s', 'c', 'completed')), 'join', 'an in-flight duplicate joins the one append')
  assert.equal(ledger.settle(call('s', 'c'), 'committed'), 'settled')
  assert.equal(ledger.observe(terminal('s', 'c', 'completed')), 'skip', 'a replayed terminal after commit is not a second fact')
  assert.throws(() => ledger.settle(call('s', 'c'), 'committed'), /no pending checkpoint append/)
})

test('SPEC[compression-004] an error terminal closes the call without a checkpoint and without blocking others', () => {
  const ledger = CheckpointSettlement()
  assert.equal(ledger.observe(terminal('s', 'bad', 'error')), 'skip')
  assert.equal(ledger.observe(terminal('s', 'bad', 'completed')), 'skip', 'the same call cannot later be completed into a checkpoint')
  assert.equal(ledger.observe(terminal('s', 'good', 'completed')), 'append')
})

test('SPEC[compression-004] sessions and call ids never alias', () => {
  const ledger = CheckpointSettlement()
  assert.equal(ledger.observe(terminal('a', 'b|c', 'completed')), 'append')
  assert.equal(ledger.observe(terminal('a|b', 'c', 'completed')), 'append')
  assert.equal(ledger.observe(terminal('1:a', 'c', 'completed')), 'append')
  assert.equal(ledger.observe(terminal('b', 'b|c', 'completed')), 'append')
})

test('SPEC[compression-004] final append failures are never retried; an unattempted write is released', () => {
  for (const outcome of ['WriteUnknown', 'NoNewWriteReleaseFailed', 'FactRejected']) {
    const ledger = CheckpointSettlement()
    assert.equal(ledger.observe(terminal('s', 'c', 'completed')), 'append')
    assert.equal(ledger.settle(call('s', 'c'), outcome), 'failed')
    assert.equal(ledger.observe(terminal('s', 'c', 'completed')), 'join', `${outcome}: later duplicates observe the same failure`)
  }
  const ledger = CheckpointSettlement()
  assert.equal(ledger.observe(terminal('s', 'c', 'completed')), 'append')
  assert.equal(ledger.settle(call('s', 'c'), 'WriterUnavailable'), 'released')
  assert.equal(ledger.observe(terminal('s', 'c', 'completed')), 'append', 'a retry reaches a fresh writer admission')
})

test('SPEC[compression-004] malformed input is rejected without changing state', () => {
  const ledger = CheckpointSettlement()
  assert.throws(() => ledger.observe(terminal('s', 'c', 'running')), /completed or error/)
  assert.throws(() => ledger.observe(terminal('', 'c', 'completed')), /session must be a non-empty string/)
  assert.throws(() => ledger.observe({ session: 's', status: 'completed' }), /terminal.callId is required/)
  assert.throws(() => ledger.observe(null), /terminal must be an object/)
  const sneaky = { session: 's', status: 'completed' }
  let reads = 0
  Object.defineProperty(sneaky, 'callId', { enumerable: true, get: () => { reads++; return 'c' } })
  assert.throws(() => ledger.observe(sneaky), /Accessor field is not accepted: callId/)
  assert.equal(reads, 0)
  assert.equal(ledger.observe(terminal('s', 'c', 'completed')), 'append', 'rejected inputs left no mark')
  assert.throws(() => ledger.settle(call('s', 'c'), 'Committed'), /outcome must be/)
  assert.equal(ledger.settle(call('s', 'c'), 'committed'), 'settled')
})

test('SPEC[compression-004] instances are independent', () => {
  const a = CheckpointSettlement()
  const b = CheckpointSettlement()
  assert.equal(a.observe(terminal('s', 'c', 'completed')), 'append')
  assert.equal(b.observe(terminal('s', 'c', 'completed')), 'append')
})
