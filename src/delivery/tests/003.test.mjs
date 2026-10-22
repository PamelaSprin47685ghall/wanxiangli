import test from 'node:test'
import assert from 'node:assert/strict'
import { Delivery, fence, piece, keys, claimed } from './support.mjs'

test('SPEC[delivery-003] peek presents without advancing the returned cursor', () => {
  const delivery = Delivery()
  delivery.deliver('s', fence(), ['selected'])
  for (let round = 0; round < 2; round += 1) {
    const ticket = claimed(delivery, 's', { mode: 'peek' })
    assert.deepEqual(keys(delivery.handOff(ticket, [piece('a'), piece('b')])), ['a', 'b'])
  }
  assert.deepEqual(delivery.returned('s'), [])
  assert.deepEqual(delivery.peek('s'), ['selected'])
})

test('SPEC[delivery-003] identical material is returned once, changed material stays visible', () => {
  const delivery = Delivery()
  delivery.deliver('s', fence('run-1', 'call-1'), ['first'])
  const first = delivery.handOff(claimed(delivery, 's', { mode: 'run', fence: fence('run-1', 'call-1') }), [piece('a'), piece('b')])
  assert.deepEqual(keys(first), ['a', 'b'])
  delivery.deliver('s', fence('run-2', 'call-2'), ['second'])
  const second = delivery.handOff(claimed(delivery, 's', { mode: 'run', fence: fence('run-2', 'call-2') }), [piece('a'), piece('c')])
  assert.deepEqual(keys(second), ['c'])
  assert.deepEqual([...delivery.returned('s')].sort(), ['a', 'b', 'c'])
})

test('SPEC[delivery-003] the composer can retain each current report with its own call identity', () => {
  const delivery = Delivery()
  const report = 'The report is unchanged.'
  for (const call of ['first', 'second']) {
    delivery.deliver('s', fence('run', call), [])
    const ticket = claimed(delivery, 's', { mode: 'run', fence: fence('run', call) })
    assert.deepEqual(ticket.fence, fence('run', call))
    assert.ok(Object.isFrozen(ticket.fence))
    const current = { key: `turn:${ticket.fence.toolCallId}`, text: report }
    assert.deepEqual(delivery.handOff(ticket, [current]), [current])
  }
})

test('SPEC[delivery-003] the owner does not invent or interpret text when carry is empty', () => {
  const delivery = Delivery()
  delivery.stage('s', [])
  const ticket = claimed(delivery, 's', { mode: 'cache' })
  assert.equal(ticket.fence, null)
  assert.deepEqual(delivery.handOff(ticket, []), [])
})

test('SPEC[delivery-003] candidates keep their order and duplicates, as selected by the composer', () => {
  const delivery = Delivery()
  delivery.stage('s', [])
  const pieces = delivery.handOff(claimed(delivery, 's', { mode: 'cache' }), [piece('b'), piece('a'), piece('b')])
  assert.deepEqual(keys(pieces), ['b', 'a', 'b'])
})

test('SPEC[delivery-003] clearReturned resets the cursor without touching the cell', () => {
  const delivery = Delivery()
  delivery.stage('s', ['first'])
  delivery.handOff(claimed(delivery, 's', { mode: 'cache' }), [piece('a')])
  delivery.stage('s', ['second'])
  delivery.clearReturned('s')
  assert.deepEqual(delivery.returned('s'), [])
  assert.deepEqual(keys(delivery.handOff(claimed(delivery, 's', { mode: 'peek' }), [piece('a')])), ['a'])
  assert.deepEqual(delivery.peekCached('s'), ['second'])
})
