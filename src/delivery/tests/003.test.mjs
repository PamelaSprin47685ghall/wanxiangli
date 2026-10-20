import test from 'node:test'
import assert from 'node:assert/strict'
import { Delivery, fence, piece, keys } from './support.mjs'

const proseKey = (session, text) => `prose:${session}:${text.length}:${text.substring(0, 24)}`

test('SPEC[delivery-003] peek presents without advancing the returned cursor', () => {
  const delivery = Delivery()
  delivery.deliver('s', fence(), { v: 1 })
  for (let round = 0; round < 2; round += 1) {
    const ticket = delivery.claim('s', { mode: 'peek' })
    assert.deepEqual(keys(delivery.handOff(ticket, [piece('a'), piece('b')], null)), ['a', 'b'])
  }
  assert.deepEqual(delivery.returned('s'), [])
  assert.deepEqual(delivery.peek('s'), { v: 1 }, 'peek leaves the cell in place')
})

test('SPEC[delivery-003] identical material is returned once, changed material stays visible', () => {
  const delivery = Delivery()
  delivery.deliver('s', fence('run-1'), { v: 1 })
  const first = delivery.handOff(delivery.claim('s', { mode: 'run', providerRun: 'run-1' }), [piece('a'), piece('b')], null)
  assert.deepEqual(keys(first), ['a', 'b'])
  delivery.deliver('s', fence('run-2'), { v: 2 })
  const second = delivery.handOff(delivery.claim('s', { mode: 'run', providerRun: 'run-2' }), [piece('a'), piece('c')], null)
  assert.deepEqual(keys(second), ['c'])
  assert.deepEqual([...delivery.returned('s')].sort(), ['a', 'b', 'c'])
})

test('SPEC[delivery-003] assistant prose is appended once and only when the cell carries a view', () => {
  const delivery = Delivery()
  const prose = 'I changed the parser and ran the suite; two cases remain open.'
  delivery.stage('s', { v: 1 })
  const first = delivery.handOff(delivery.claim('s', { mode: 'cache' }), [piece('a')], prose)
  assert.deepEqual(first, [piece('a'), { key: proseKey('s', prose), text: prose }])
  delivery.stage('s', { v: 2 })
  const again = delivery.handOff(delivery.claim('s', { mode: 'cache' }), [piece('b')], prose)
  assert.deepEqual(keys(again), ['b'], 'the same prose is not returned twice')
  delivery.stage('s', undefined)
  const viewless = delivery.handOff(delivery.claim('s', { mode: 'cache' }), [], 'new prose')
  assert.deepEqual(viewless, [], 'no view, no prose')
  delivery.stage('s', { v: 3 })
  assert.deepEqual(delivery.handOff(delivery.claim('s', { mode: 'cache' }), [], '   \n'), [], 'blank prose is not material')
})

test('SPEC[delivery-003] prose already selected by the view is not appended a second time', () => {
  const delivery = Delivery()
  const prose = 'summary'
  delivery.stage('s', { v: 1 })
  const named = { key: proseKey('s', prose), text: prose }
  assert.deepEqual(delivery.handOff(delivery.claim('s', { mode: 'peek' }), [named], prose), [named])
})

test('SPEC[delivery-003] candidates keep their order and duplicates, as selected by the composer', () => {
  const delivery = Delivery()
  delivery.stage('s', { v: 1 })
  const pieces = delivery.handOff(delivery.claim('s', { mode: 'cache' }), [piece('b'), piece('a'), piece('b')], null)
  assert.deepEqual(keys(pieces), ['b', 'a', 'b'])
})

test('SPEC[delivery-003] clearReturned resets the cursor without touching the cell', () => {
  const delivery = Delivery()
  delivery.stage('s', { v: 1 })
  delivery.handOff(delivery.claim('s', { mode: 'cache' }), [piece('a')], null)
  delivery.stage('s', { v: 2 })
  delivery.clearReturned('s')
  assert.deepEqual(delivery.returned('s'), [])
  assert.deepEqual(keys(delivery.handOff(delivery.claim('s', { mode: 'peek' }), [piece('a')], null)), ['a'])
  assert.deepEqual(delivery.peekCached('s'), { v: 2 })
})
