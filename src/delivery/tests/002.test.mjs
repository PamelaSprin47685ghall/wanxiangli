import test from 'node:test'
import assert from 'node:assert/strict'
import { Delivery, fence, piece, keys } from './support.mjs'

test('SPEC[delivery-002] an older run cannot take a newer run delivery and the cell stays intact', () => {
  const delivery = Delivery()
  const view = { v: 2 }
  delivery.deliver('s', fence('run-2', 'call-2'), view)
  assert.equal(delivery.claim('s', { mode: 'run', providerRun: 'run-1' }), null)
  assert.equal(delivery.peek('s'), view)
  const ticket = delivery.claim('s', { mode: 'run', providerRun: 'run-2' })
  assert.equal(ticket.view, view)
  assert.deepEqual(keys(delivery.handOff(ticket, [piece('a')], null)), ['a'])
  assert.equal(delivery.peekCached('s'), null)
  assert.deepEqual(delivery.returned('s'), ['a'])
})

test('SPEC[delivery-002] a run claim never takes a staged view, a cache claim never takes a delivery', () => {
  const delivery = Delivery()
  delivery.stage('staged', { staged: true })
  assert.equal(delivery.claim('staged', { mode: 'run', providerRun: 'run-1' }), null)
  assert.deepEqual(delivery.peekCached('staged'), { staged: true })
  delivery.deliver('fenced', fence(), { fenced: true })
  assert.equal(delivery.claim('fenced', { mode: 'cache' }), null)
  assert.deepEqual(delivery.peek('fenced'), { fenced: true })
  const ticket = delivery.claim('staged', { mode: 'cache' })
  assert.deepEqual(ticket.view, { staged: true })
  assert.equal(delivery.peekCached('staged'), null)
})

test('SPEC[delivery-002] claims on an empty session return null; unknown modes are rejected', () => {
  const delivery = Delivery()
  for (const request of [{ mode: 'peek' }, { mode: 'cache' }, { mode: 'run', providerRun: 'r' }]) {
    assert.equal(delivery.claim('none', request), null)
  }
  assert.throws(() => delivery.claim('none', { mode: 'drain' }), /Unknown claim mode/)
  assert.throws(() => delivery.claim('none', { mode: 'run' }), /providerRun/)
})
