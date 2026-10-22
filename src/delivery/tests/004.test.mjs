import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Delivery, fence, piece, claimed } from './support.mjs'

test('SPEC[delivery-004] a ticket is spent once and only by the instance that issued it', () => {
  const one = Delivery()
  const two = Delivery()
  one.stage('s', { v: 1 })
  const ticket = claimed(one, 's', { mode: 'peek' })
  assert.throws(() => two.handOff(ticket, []), /not issued by this delivery/)
  assert.throws(() => one.handOff({ view: {} }, []), /not issued by this delivery/)
  assert.ok(Object.isFrozen(ticket), 'a ticket cannot be retargeted by the caller')
  one.handOff(ticket, [piece('a')])
  assert.throws(() => one.handOff(ticket, [piece('a')]), /already spent/)
})

test('SPEC[delivery-004] accessor fields are rejected before any caller code runs', () => {
  const delivery = Delivery()
  let reads = 0
  const sneaky = Object.defineProperty({ toolCallId: 'c' }, 'providerRun', { enumerable: true, get() { reads += 1; delivery.clearAll(); return 'r' } })
  assert.throws(() => delivery.deliver('s', sneaky, {}), /Missing field or accessor: providerRun/)
  delivery.stage('s', { v: 1 })
  const ticket = claimed(delivery, 's', { mode: 'peek' })
  const sneakyPiece = Object.defineProperty({ key: 'k' }, 'text', { enumerable: true, get() { reads += 1; return 'x' } })
  assert.throws(() => delivery.handOff(ticket, [sneakyPiece]), /Missing field or accessor: text/)
  assert.equal(reads, 0)
  assert.deepEqual(delivery.peekCached('s'), { v: 1 })
})

test('SPEC[delivery-004] malformed input is refused without changing state', () => {
  const delivery = Delivery()
  delivery.deliver('s', fence(), { v: 1 })
  assert.throws(() => delivery.deliver('', fence(), {}), /sessionId/)
  assert.throws(() => delivery.deliver('s', { providerRun: 'r', toolCallId: '' }, {}), /toolCallId/)
  assert.throws(() => delivery.stage(undefined, {}), /sessionId/)
  const ticket = claimed(delivery, 's', { mode: 'peek' })
  assert.throws(() => delivery.handOff(ticket, [{ key: 'k', text: 3 }]), /text must be a string/)
  assert.throws(() => delivery.handOff(claimed(delivery, 's', { mode: 'peek' }), null), /candidates/)
  assert.deepEqual(delivery.fence('s'), fence())
})

test('SPEC[delivery-004] sessions and instances are isolated; clear and clearAll are scoped', () => {
  const one = Delivery()
  const two = Delivery()
  one.deliver('a', fence(), { a: true })
  one.deliver('b', fence(), { b: true })
  two.deliver('a', fence('other'), { other: true })
  one.clear('a')
  assert.equal(one.peek('a'), null)
  assert.deepEqual(one.peek('b'), { b: true })
  assert.deepEqual(two.peek('a'), { other: true })
  one.clearAll()
  assert.equal(one.peek('b'), null)
  assert.deepEqual(two.fence('a'), fence('other'))
})

test('SPEC[delivery-004] the artifact imports no sibling module, host SDK, timer or I/O', () => {
  const artifact = readFileSync(new URL('../../../dist/delivery/Delivery.js', import.meta.url), 'utf8')
  assert.doesNotMatch(artifact, /from ["'](wanxiangli\/|node:|@opencode)/)
  assert.doesNotMatch(artifact, /\b(setTimeout|setInterval|Date\.now|readFileSync|writeFileSync)\b/)
})
