import test from 'node:test'
import assert from 'node:assert/strict'
import { Delivery, fence } from './support.mjs'

test('SPEC[delivery-001] only a fenced cell answers take, peek and fence', () => {
  const delivery = Delivery()
  const view = [3, 'literal']
  delivery.stage('s', view)
  assert.equal(delivery.peek('s'), null)
  assert.equal(delivery.fence('s'), null)
  assert.equal(delivery.take('s'), null)
  assert.equal(delivery.peekCached('s'), view, 'a staged view stays for presentation')
  delivery.deliver('s', fence(), view)
  assert.equal(delivery.peek('s'), view, 'the view is opaque and kept by identity')
  assert.deepEqual(delivery.fence('s'), fence())
  assert.equal(delivery.take('s'), view)
  assert.equal(delivery.peekCached('s'), null, 'take removes the delivered cell')
})

test('SPEC[delivery-001] a staged view never downgrades a fenced delivery', () => {
  const delivery = Delivery()
  const delivered = { delivered: true }
  delivery.deliver('s', fence(), delivered)
  delivery.stage('s', { staged: true })
  assert.equal(delivery.peek('s'), delivered)
  assert.deepEqual(delivery.fence('s'), fence())
})

test('SPEC[delivery-001] a later delivery replaces the cell with its own fence', () => {
  const delivery = Delivery()
  delivery.stage('s', { staged: true })
  delivery.deliver('s', fence('run-1', 'call-1'), { first: true })
  delivery.deliver('s', fence('run-2', 'call-9'), { second: true })
  assert.deepEqual(delivery.fence('s'), fence('run-2', 'call-9'))
  assert.deepEqual(delivery.peek('s'), { second: true })
})

test('SPEC[delivery-001] a fenced delivery without a view is still a delivery cell', () => {
  const delivery = Delivery()
  delivery.deliver('s', fence(), undefined)
  assert.deepEqual(delivery.fence('s'), fence())
  assert.equal(delivery.peek('s'), null)
  delivery.stage('s', { staged: true })
  assert.equal(delivery.peekCached('s'), null, 'stage did not replace the empty delivery')
  assert.equal(delivery.take('s'), null)
  assert.equal(delivery.fence('s'), null, 'take removed the empty delivery')
})

test('SPEC[delivery-001] the fence is a frozen copy, not an alias of the input', () => {
  const delivery = Delivery()
  const input = fence()
  delivery.deliver('s', input, {})
  input.providerRun = 'mutated'
  const read = delivery.fence('s')
  assert.equal(read.providerRun, 'run-1')
  assert.ok(Object.isFrozen(read))
})

