import test from 'node:test'
import assert from 'node:assert/strict'
import { ExternalNamespaces as owner } from '../../../dist/external-namespaces/ExternalNamespaces.js'

test('SPEC[external-namespaces-001] historical declarations survive later narrower configurations', () => {
  const old = 'gxx_old_config_20261024'
  const next = 'gxx_next_config_20261024'
  const before = [old, old]
  assert.deepEqual(owner.patterns(before), [old + '_*', old + '_*'])
  assert.equal(owner.matches(old + '_read'), false)

  owner.declare([old])
  assert.equal(owner.matches(old + '_read'), true)
  assert.equal(owner.matches(old + '_'), true)
  assert.equal(owner.matches(old), false)
  assert.equal(owner.matches(old + 'Other_read'), false)
  assert.equal(owner.matches(old.toUpperCase() + '_read'), false)

  owner.declare([next])
  assert.deepEqual(owner.patterns([next]), [next + '_*'])
  assert.equal(owner.matches(old + '_read'), true)
  assert.equal(owner.matches(next + '_search'), true)

  owner.declare([next, next])
  owner.declare([])
  assert.deepEqual(owner.patterns([]), [])
  assert.equal(owner.matches('gxx_unknown_tool'), false)
})
