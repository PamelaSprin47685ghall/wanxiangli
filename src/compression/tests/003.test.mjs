import test from 'node:test'
import assert from 'node:assert/strict'
import { Compression } from './support.mjs'

const law = Compression()

test('SPEC[compression-003] sparse arrays and index getters are refused without reads', () => {
  const sparse = [1]
  sparse.length = 3
  assert.match(law.parseCarry(sparse).reason, /sparse/)

  let reads = 0
  const accessor = [1, 'second']
  Object.defineProperty(accessor, '1', { get() { reads++; return 'hidden' } })
  assert.match(law.parseCarry(accessor).reason, /Accessor field/)
  assert.equal(reads, 0)
})

test('SPEC[compression-003] snapshots cannot be changed through caller arrays or result aliases', () => {
  const carry = [2, 'literal', 2]
  const parsed = law.parseView({ prefixCount: 1, carry })
  assert.equal(parsed.ok, true)
  assert.ok(Object.isFrozen(parsed))
  assert.ok(Object.isFrozen(parsed.view))
  assert.ok(Object.isFrozen(parsed.view.carry))
  carry[0] = 99
  carry.push('late')
  assert.deepEqual(parsed.view.carry, [2, 'literal', 2])
  assert.throws(() => { parsed.view.carry[1] = 'changed' }, TypeError)
})

test('SPEC[compression-003] custom iterators and serialization hooks cannot replace validated entries', () => {
  let hooks = 0
  const carry = [4, 'original']
  carry.toJSON = () => { hooks++; return ['injected'] }
  carry[Symbol.iterator] = function* () { hooks++; yield 'injected' }
  const parsed = law.parseCarry(carry)
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.carry, [4, 'original'])
  assert.equal(JSON.stringify(parsed.carry), '[4,"original"]')
  assert.equal(hooks, 0)
})
