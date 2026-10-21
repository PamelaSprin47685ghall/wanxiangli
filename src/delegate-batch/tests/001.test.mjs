import test from 'node:test'
import assert from 'node:assert/strict'

import { DelegateBatchLaw } from 'wanxiangli/delegate-batch'

const law = new DelegateBatchLaw()
const plain = (v) => JSON.parse(JSON.stringify(v))
const admit = (active, pending, batch) => plain(law.admit({ active, pending, batch }))
const b = (providerRun, callOrder, currentCall) => ({ providerRun, callOrder, currentCall })
const p = (providerRun, callOrder, received) => ({ providerRun, callOrder, received })
const no = (reason) => ({ verdict: 'reject', reason })

test('SPEC[delegate-batch-1] one admitted batch per dedicated delegate; an ungrouped call never joins a pending batch', () => {
  assert.deepEqual(admit(true, null, null), no('ActiveBatch'))
  assert.deepEqual(admit(true, null, b('r', ['a'], 'a')), no('ActiveBatch'))
  assert.deepEqual(admit(false, null, null), { verdict: 'single' })
  assert.deepEqual(admit(false, p('r', ['a', 'b'], ['a']), null), no('BatchPending'))
})

test('SPEC[delegate-batch-2] a batch is ProviderRun + call order; it is admitted whole, in provider order, only when complete', () => {
  assert.deepEqual(admit(false, null, b('r', ['a', 'b'], 'b')), { verdict: 'wait', open: true })
  assert.deepEqual(admit(false, p('r', ['a', 'b'], ['b']), b('r', ['a', 'b'], 'a')), { verdict: 'ready', open: false, order: ['a', 'b'] })
  assert.deepEqual(admit(false, null, b('r', ['a'], 'a')), { verdict: 'ready', open: true, order: ['a'] })
  assert.deepEqual(admit(false, p('r', ['a', 'b', 'c'], ['c']), b('r', ['a', 'b', 'c'], 'a')), { verdict: 'wait', open: false })
})

test('SPEC[delegate-batch-2] counterexamples: scheduler timing never merges two runs, a call never counts twice, malformed batches are refused', () => {
  assert.deepEqual(admit(false, p('r1', ['a', 'b'], ['a']), b('r2', ['a', 'b'], 'b')), no('OtherRunPending'))
  assert.deepEqual(admit(false, p('r', ['a', 'b'], ['a']), b('r', ['b', 'a'], 'b')), no('OtherRunPending'))
  assert.deepEqual(admit(false, p('r', ['a', 'b'], ['a']), b('r', ['a', 'b'], 'a')), no('DuplicateCall'))
  assert.deepEqual(admit(false, null, b('r', [], 'a')), no('InvalidBatch'))
  assert.deepEqual(admit(false, null, b('r', ['a', 'a'], 'a')), no('InvalidBatch'))
  assert.deepEqual(admit(false, null, b('r', ['a', 'b'], 'c')), no('InvalidBatch'))
  assert.deepEqual(admit(false, p('x', ['q'], []), b('r', ['a', 'a'], 'a')), no('InvalidBatch'))
})

test('SPEC[delegate-batch-3] the observed batch is the role\'s calls in Host order, only when the current call is among them', () => {
  const calls = [{ role: 'Coder', callId: 'a' }, { role: 'DevOps', callId: 'x' }, { role: 'Coder', callId: 'b' }]
  assert.deepEqual(plain(law.observedBatch({ role: 'Coder', currentCall: 'b', calls })), ['a', 'b'])
  assert.deepEqual(plain(law.observedBatch({ role: 'DevOps', currentCall: 'x', calls })), ['x'])
  assert.equal(law.observedBatch({ role: 'Coder', currentCall: 'x', calls }), null)
  assert.equal(law.observedBatch({ role: 'Coder', currentCall: 'a', calls: [] }), null)
})

test('SPEC[delegate-batch] results are frozen and malformed input is refused', () => {
  assert.ok(Object.isFrozen(law.admit({ active: false, pending: null, batch: b('r', ['a'], 'a') })))
  assert.ok(Object.isFrozen(law.admit({ active: false, pending: null, batch: b('r', ['a'], 'a') }).order))
  assert.throws(() => law.admit({ active: 'no', pending: null, batch: null }))
  assert.throws(() => law.admit({ active: false, pending: null, batch: { providerRun: 'r', callOrder: 'a', currentCall: 'a' } }))
  assert.throws(() => law.observedBatch({ role: 'Coder', currentCall: 'a', calls: [{ role: 1, callId: 'a' }] }))
})
