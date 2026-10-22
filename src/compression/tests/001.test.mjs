import test from 'node:test'
import assert from 'node:assert/strict'
import { Compression } from './support.mjs'

const law = Compression()

test('SPEC[compression-001] compression requires a prefix count and an ordered carry array', () => {
  const view = { prefixCount: 2, carry: [7, 'new summary', 3, 0] }
  assert.deepEqual(law.parseView(view), { ok: true, view })
  assert.deepEqual(law.parseView({ prefixCount: 0, carry: [] }), {
    ok: true, view: { prefixCount: 0, carry: [] },
  })
})

test('SPEC[compression-001] incomplete, retired and extra fields are refused', () => {
  for (const value of [
    null, [], {}, { prefixCount: 0 }, { carry: [] },
    { prefixUntil: 0, thenMap: {} },
    { prefixCount: 0, carry: [], extra: true },
    { prefixCount: 0, carry: [], [Symbol('extra')]: true },
  ]) {
    const result = law.parseView(value)
    assert.equal(result.ok, false)
    assert.equal(typeof result.reason, 'string')
  }
})

test('SPEC[compression-001] prefix counts must be non-negative integers', () => {
  for (const prefixCount of [undefined, null, -1, 1.5, '1', NaN, Infinity, 2147483647]) {
    const result = law.parseView({ prefixCount, carry: [] })
    assert.equal(result.ok, false)
    assert.match(result.reason, /prefixCount/)
  }
})

test('SPEC[compression-001] declaration accessors are refused before execution', () => {
  for (const field of ['prefixCount', 'carry']) {
    let reads = 0
    const input = { prefixCount: 0, carry: [] }
    Object.defineProperty(input, field, {
      enumerable: true,
      get() { reads++; throw new Error('must not run') },
    })
    const result = law.parseView(input)
    assert.equal(result.ok, false)
    assert.match(result.reason, /Accessor field/)
    assert.equal(reads, 0)
  }
})
