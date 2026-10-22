import test from 'node:test'
import assert from 'node:assert/strict'
import { Delivery, fence, piece, keys, claimed, refusal } from './support.mjs'

test('SPEC[delivery-002] an older run cannot take a newer run delivery and the cell stays intact', () => {
  const delivery = Delivery()
  const view = { v: 2 }
  delivery.deliver('s', fence('run-2', 'call-2'), view)
  assert.equal(refusal(delivery, 's', { mode: 'run', fence: fence('run-1', 'call-1') }), 'fence-mismatch')
  assert.equal(delivery.peek('s'), view)
  const ticket = claimed(delivery, 's', { mode: 'run', fence: fence('run-2', 'call-2') })
  assert.equal(ticket.view, view)
  assert.deepEqual(ticket.fence, fence('run-2', 'call-2'))
  assert.deepEqual(keys(delivery.handOff(ticket, [piece('a')])), ['a'])
  assert.equal(delivery.peekCached('s'), null)
  assert.deepEqual(delivery.returned('s'), ['a'])
})

test('SPEC[delivery-002] a run claim never takes a staged view, a cache claim never takes a delivery', () => {
  const delivery = Delivery()
  delivery.stage('staged', { staged: true })
  assert.equal(refusal(delivery, 'staged', { mode: 'run', fence: fence('run-1') }), 'fence-mismatch')
  assert.deepEqual(delivery.peekCached('staged'), { staged: true })
  delivery.deliver('fenced', fence(), { fenced: true })
  assert.equal(refusal(delivery, 'fenced', { mode: 'cache' }), 'not-staged')
  assert.deepEqual(delivery.peek('fenced'), { fenced: true })
  const ticket = claimed(delivery, 'staged', { mode: 'cache' })
  assert.deepEqual(ticket.view, { staged: true })
  assert.deepEqual(delivery.peekCached('staged'), { staged: true }, 'claiming alone takes nothing')
  assert.deepEqual(delivery.handOff(ticket, []), [])
  assert.equal(delivery.peekCached('staged'), null, 'the completed hand-off takes the staged cell')
})

test('SPEC[delivery-002] claims on an empty session are refused; unknown modes are rejected', () => {
  const delivery = Delivery()
  for (const request of [{ mode: 'peek' }, { mode: 'cache' }, { mode: 'run', fence: fence() }]) {
    assert.equal(refusal(delivery, 'none', request), 'no-cell')
  }
  assert.throws(() => delivery.claim('none', { mode: 'drain' }), /Unknown claim mode/)
  assert.throws(() => delivery.claim('none', { mode: 'run' }), /fence/)
  assert.throws(() => delivery.claim('none', { mode: 'run', fence: { providerRun: 'r' } }), /toolCallId/)
})
