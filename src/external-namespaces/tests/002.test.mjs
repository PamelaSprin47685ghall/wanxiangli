import test from 'node:test'
import assert from 'node:assert/strict'
import { ExternalNamespaces as owner } from '../../../dist/external-namespaces/ExternalNamespaces.js'

test('SPEC[external-namespaces-002] randomized config reloads never weaken the runtime namespace gate', () => {
  const names = Array.from({ length: 23 }, (_, index) => 'gxx_generated_20261024_' + index)
  const admitted = new Set()
  let seed = 0x73a5b1fc
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed
  }

  for (let step = 0; step < 12000; step++) {
    const count = next() % 8
    const current = Array.from({ length: count }, () => names[next() % names.length])
    assert.deepEqual(owner.patterns(current), current.map(name => name + '_*'))
    if (next() % 3 !== 0) {
      owner.declare(current)
      current.forEach(name => admitted.add(name))
    }

    for (const name of names) {
      assert.equal(owner.matches(name + '_lookup'), admitted.has(name))
      assert.equal(owner.matches(name), false)
      assert.equal(owner.matches(name.toUpperCase() + '_lookup'), false)
    }
    assert.equal(owner.matches('gxx_generated_not_declared_search'), false)
  }
})
