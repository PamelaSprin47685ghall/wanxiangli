import test from 'node:test'
import assert from 'node:assert/strict'
import { Compression } from './support.mjs'

const law = Compression()

test('SPEC[compression-002] carry preserves order, repetition and literal bytes', () => {
  const carry = [8, '8', 2, '', '  \n', 8, '\u0000', 'Unicode 字面值']
  assert.deepEqual(law.parseCarry(carry), { ok: true, carry })
  assert.deepEqual(law.parseView({ prefixCount: 0, carry }).view.carry, carry)
})

test('SPEC[compression-002] transfer carries have no prefix or wrapper', () => {
  assert.deepEqual(law.parseCarry([]), { ok: true, carry: [] })
  for (const value of [undefined, null, false, 1, 'text', {}, { carry: [] }, { prefixCount: 0, carry: [] }]) {
    assert.equal(law.parseCarry(value).ok, false)
  }
})

test('SPEC[compression-002] invalid entries reject the entire carry', () => {
  for (const item of [null, undefined, false, true, {}, [], -1, 2.5, Infinity, NaN, 2147483647]) {
    const result = law.parseCarry(['valid first', item, 3])
    assert.equal(result.ok, false)
    assert.match(result.reason, /carry\[1\]/)
    assert.equal(Object.hasOwn(result, 'carry'), false)
  }
})
