import test from 'node:test'
import assert from 'node:assert/strict'
import { Delivery, fence, piece, keys, claimed, refusal } from './support.mjs'

test('SPEC[delivery-005] the owner compares the whole call identity, not only the run', () => {
  const delivery = Delivery()
  const view = { v: 1 }
  delivery.deliver('s', fence('run-1', 'call-1'), view)
  assert.equal(refusal(delivery, 's', { mode: 'run', fence: fence('run-1', 'call-2') }), 'fence-mismatch')
  assert.equal(refusal(delivery, 's', { mode: 'observe', fence: fence('run-2', 'call-1') }), 'fence-mismatch')
  assert.deepEqual(delivery.peek('s'), view, 'a refused claim leaves the cell where it is')
  assert.deepEqual(delivery.returned('s'), [], 'a refused claim advances nothing')
  const ticket = claimed(delivery, 's', { mode: 'run', fence: fence('run-1', 'call-1') })
  assert.deepEqual(keys(delivery.handOff(ticket, [piece('a')])), ['a'])
})

test('SPEC[delivery-005] a failed selection keeps the material; the cell is taken only when the hand-off completes', () => {
  const delivery = Delivery()
  const view = { v: 1 }
  delivery.deliver('s', fence(), view)
  const ticket = claimed(delivery, 's', { mode: 'run', fence: fence() })
  assert.throws(() => delivery.handOff(ticket, [{ key: 'k', text: 3 }]), /text must be a string/)
  assert.deepEqual(delivery.peek('s'), view, 'the material is still in the cell')
  assert.deepEqual(delivery.returned('s'), [], 'the cursor did not move')
  const again = claimed(delivery, 's', { mode: 'run', fence: fence() })
  assert.deepEqual(keys(delivery.handOff(again, [piece('a')])), ['a'])
  assert.equal(delivery.peekCached('s'), null, 'the completed hand-off takes the cell')
})

test('SPEC[delivery-005] a claim does not consume: the cell survives until the hand-off completes', () => {
  const delivery = Delivery()
  const view = { v: 1 }
  delivery.deliver('s', fence(), view)
  claimed(delivery, 's', { mode: 'run', fence: fence() })
  assert.deepEqual(delivery.peek('s'), view, 'claiming alone takes nothing')
  assert.deepEqual(delivery.returned('s'), [])
})

test('SPEC[delivery-005] one cell is handed off once: a second hand-off has no cell left', () => {
  const delivery = Delivery()
  delivery.deliver('s', fence(), { v: 1 })
  const first = claimed(delivery, 's', { mode: 'run', fence: fence() })
  const second = claimed(delivery, 's', { mode: 'run', fence: fence() })
  assert.deepEqual(keys(delivery.handOff(first, [piece('a')])), ['a'])
  assert.throws(() => delivery.handOff(second, [piece('a')]), /no longer valid/)
  assert.deepEqual(delivery.returned('s'), ['a'], 'the material was handed back once')
})

test('SPEC[delivery-005] a ticket issued before clearAll cannot advance the cursor afterwards', () => {
  const delivery = Delivery()
  delivery.deliver('s', fence(), { v: 1 })
  const ticket = claimed(delivery, 's', { mode: 'run', fence: fence() })
  delivery.clearAll()
  assert.throws(() => delivery.handOff(ticket, [piece('a')]), /invalidated by clearAll/)
  assert.deepEqual(delivery.returned('s'), [], 'the stale ticket advanced nothing')
})

test('SPEC[delivery-005] a ticket issued before a session clear cannot advance that session afterwards', () => {
  const delivery = Delivery()
  delivery.deliver('s', fence(), { v: 1 })
  const ticket = claimed(delivery, 's', { mode: 'run', fence: fence() })
  delivery.clear('s')
  assert.throws(() => delivery.handOff(ticket, [piece('a')]), /invalidated by clear/)
  assert.deepEqual(delivery.returned('s'), [])
})

test('SPEC[delivery-005] a replaced cell invalidates the ticket that pointed at the old one', () => {
  const delivery = Delivery()
  delivery.deliver('s', fence('run-1', 'call-1'), { first: true })
  const ticket = claimed(delivery, 's', { mode: 'run', fence: fence('run-1', 'call-1') })
  delivery.deliver('s', fence('run-2', 'call-2'), { second: true })
  assert.throws(() => delivery.handOff(ticket, [piece('a')]), /no longer valid/)
  assert.deepEqual(delivery.returned('s'), [], 'the newer cell was not consumed by the older ticket')
})

test('SPEC[delivery-005] observe reports the fence match without taking anything', () => {
  const delivery = Delivery()
  delivery.deliver('s', fence('run-1', 'call-1'), { v: 1 })
  const ticket = claimed(delivery, 's', { mode: 'observe', fence: fence('run-1', 'call-1') })
  assert.deepEqual(ticket.fence, fence('run-1', 'call-1'))
  assert.deepEqual(delivery.peek('s'), { v: 1 }, 'the cell is still there')
  assert.deepEqual(delivery.returned('s'), [])
  assert.deepEqual(keys(delivery.handOff(ticket, [piece('a')])), ['a'])
  assert.deepEqual(delivery.peek('s'), { v: 1 }, 'an observation never takes the cell')
  assert.deepEqual(delivery.returned('s'), [], 'an observation never advances the cursor')
})
