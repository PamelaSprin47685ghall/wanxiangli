import test from 'node:test'
import assert from 'node:assert/strict'
import { JsDeliveredValues, jsDeliveredValues } from './support.mjs'

test('SPEC[delivery-006] JsDeliveredValues instances are isolated from each other', () => {
  const storeA = new JsDeliveredValues()
  const storeB = new JsDeliveredValues()

  storeA.recordFencedView('sess-1', 'run-1', 'call-1', [{ text: 'item-A' }])
  assert.equal(storeA.ownsCell('sess-1', 'run-1', 'call-1'), true)
  assert.equal(storeB.ownsCell('sess-1', 'run-1', 'call-1'), false)
  assert.equal(storeB.peekCached('sess-1'), null)

  const taken = storeA.tryTakeMaterialForCall('sess-1', 'run-1', 'call-1', 'assistant note')
  assert.ok(taken !== null)
  assert.deepEqual(taken.carry, ['item-A'])
  assert.deepEqual(taken.body, ['assistant note'])
  assert.equal(storeA.peekCached('sess-1'), null)
  assert.equal(storeB.tryTakeMaterialForCall('sess-1', 'run-1', 'call-1'), null)
})

test('SPEC[delivery-006] jsDeliveredValues singleton maintains cross-call state and respects clear', () => {
  jsDeliveredValues.clearAll()

  jsDeliveredValues.recordFencedView('sess-single', 'run-x', 'call-y', ['alpha', 'beta'])
  assert.equal(jsDeliveredValues.ownsCell('sess-single', 'run-x', 'call-y'), true)
  assert.deepEqual(jsDeliveredValues.peekFence('sess-single'), { providerRun: 'run-x', toolCallId: 'call-y' })

  const peeked = jsDeliveredValues.tryPeekMaterial('sess-single')
  assert.ok(peeked !== null)
  assert.deepEqual(peeked.carry, ['alpha', 'beta'])
  assert.deepEqual(jsDeliveredValues.alreadyReturned('sess-single'), [])

  jsDeliveredValues.clear('sess-single')
  assert.equal(jsDeliveredValues.ownsCell('sess-single', 'run-x', 'call-y'), false)
  assert.equal(jsDeliveredValues.peekCached('sess-single'), null)
})

test('SPEC[delivery-006] fence mismatch refuses claim, leaves cell and cursor untouched', () => {
  const store = new JsDeliveredValues()
  store.recordFencedView('sess-fence', 'run-1', 'call-1', ['carry-val'])

  // Mismatched run
  const res1 = store.tryTakeMaterialForCall('sess-fence', 'run-2', 'call-1', 'prose')
  assert.equal(res1, null)
  assert.equal(store.ownsCell('sess-fence', 'run-1', 'call-1'), true)
  assert.deepEqual(store.alreadyReturned('sess-fence'), [])

  // Mismatched call
  const res2 = store.tryTakeMaterialForCall('sess-fence', 'run-1', 'call-2', 'prose')
  assert.equal(res2, null)
  assert.equal(store.ownsCell('sess-fence', 'run-1', 'call-1'), true)
  assert.deepEqual(store.alreadyReturned('sess-fence'), [])

  // Matching call succeeds
  const res3 = store.tryTakeMaterialForCall('sess-fence', 'run-1', 'call-1', 'prose')
  assert.ok(res3 !== null)
  assert.deepEqual(res3.carry, ['carry-val'])
  assert.deepEqual(res3.body, ['prose'])
  assert.equal(store.peekCached('sess-fence'), null)
  assert.equal(store.alreadyReturned('sess-fence').length > 0, true)
})

test('SPEC[delivery-006] returned cursor filters duplicate pieces across repeated handoffs', () => {
  const store = new JsDeliveredValues()
  store.recordFencedView('sess-dedup', 'run-1', 'call-1', ['item-1', 'item-2'])

  const first = store.tryTakeMaterialForCall('sess-dedup', 'run-1', 'call-1', 'turn-1 prose')
  assert.ok(first !== null)
  assert.deepEqual(first.carry, ['item-1', 'item-2'])
  assert.deepEqual(first.body, ['turn-1 prose'])

  // Re-stage new delivery in same session with overlapping items
  store.recordFencedView('sess-dedup', 'run-2', 'call-2', ['item-2', 'item-3'])
  const second = store.tryTakeMaterialForCall('sess-dedup', 'run-2', 'call-2', 'turn-2 prose')
  assert.ok(second !== null)
  // item-2 was already returned, so only item-3 appears in carry
  assert.deepEqual(second.carry, ['item-3'])
  assert.deepEqual(second.body, ['turn-2 prose'])

  // clearReturned resets the cursor
  store.clearReturned('sess-dedup')
  assert.deepEqual(store.alreadyReturned('sess-dedup'), [])
})

test('SPEC[delivery-006] tryTakeWitnessMaterial consumes witness body/carry and maps current assistant piece', () => {
  const store = new JsDeliveredValues()
  store.recordFencedView('sess-wit', 'run-w', 'call-w', ['ignored-in-witness-mode'])

  const witnessBody = ['historic prose 1', 'last prose']
  const witnessCarry = ['carried a', 'carried b']

  // Mismatched fence fails witness take
  assert.equal(store.tryTakeWitnessMaterial('sess-wit', 'run-other', 'call-w', witnessBody, witnessCarry, 'last prose'), null)

  // Matching fence succeeds
  const taken = store.tryTakeWitnessMaterial('sess-wit', 'run-w', 'call-w', witnessBody, witnessCarry, 'last prose')
  assert.ok(taken !== null)
  assert.deepEqual(taken.carry, ['carried a', 'carried b', 'historic prose 1'])
  assert.deepEqual(taken.body, ['last prose'])
  assert.equal(store.peekCached('sess-wit'), null)
})

test('SPEC[delivery-006] staged view presentation via recordView, tryTakeMaterialWith, and clearAll', () => {
  const store = new JsDeliveredValues()
  store.recordView('sess-staged', ['cached-1'])

  assert.equal(store.peek('sess-staged'), null, 'unfenced staged view is not a delivery')
  assert.deepEqual(store.peekCached('sess-staged'), ['cached-1'])
  assert.equal(store.peekFence('sess-staged'), null)

  const cachedHandoff = store.tryTakeMaterialWith('sess-staged', 'some note')
  assert.ok(cachedHandoff !== null)
  assert.deepEqual(cachedHandoff.carry, ['cached-1'])
  assert.deepEqual(cachedHandoff.body, ['some note'])
  assert.equal(store.peekCached('sess-staged'), null)

  store.recordView('sess-staged-2', ['cached-2'])
  store.clearAll()
  assert.equal(store.peekCached('sess-staged-2'), null)
  assert.deepEqual(store.alreadyReturned('sess-staged'), [])
})

test('SPEC[delivery-006] select and materialize pure calculations work without consuming cells', () => {
  const store = new JsDeliveredValues()
  const pieces = store.select('s', ['item1', { text: 'item2' }], ['material:"item1"'])
  assert.equal(pieces.length, 1)
  assert.equal(pieces[0].text, 'item2')

  const materialized = store.materialize('s', ['valA'], { providerRun: 'r', toolCallId: 'c' }, 'hello')
  assert.deepEqual(materialized.carry, ['valA'])
  assert.deepEqual(materialized.body, ['hello'])
})
