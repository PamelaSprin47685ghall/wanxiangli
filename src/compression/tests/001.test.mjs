import test from 'node:test'
import assert from 'node:assert/strict'
import { Compression } from './support.mjs'

const law = Compression()

test('SPEC[compression-001] a well-formed view parses into sorted pairs', () => {
  const parsed = law.parseView({ prefixUntil: 2, thenMap: { 7: 'seven', 3: null, 0: 'opening' } })
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.view, { prefixUntil: 2, thenMap: [[0, 'opening'], [3, null], [7, 'seven']] })
  assert.deepEqual(law.parseView({ prefixUntil: 0, thenMap: {} }).view, { prefixUntil: 0, thenMap: [] })
})

test('SPEC[compression-001] every malformed shape is refused with its first reason', () => {
  const reason = (value) => {
    const parsed = law.parseView(value)
    assert.equal(parsed.ok, false)
    return parsed.reason
  }
  assert.equal(reason(null), 'view must contain prefixUntil and thenMap')
  assert.equal(reason([]), 'view must contain prefixUntil and thenMap')
  assert.equal(reason({ prefixUntil: 0, thenMap: {}, extra: 1 }), 'view accepts only prefixUntil and thenMap')
  for (const prefixUntil of [undefined, -1, 1.5, '1', 2147483647]) {
    assert.equal(reason({ prefixUntil, thenMap: {} }), 'prefixUntil is required and must be a non-negative integer anchor number')
  }
  for (const thenMap of [undefined, null, [], 'x']) {
    assert.equal(reason({ prefixUntil: 0, thenMap }), 'thenMap is required and must map anchor numbers to summaries or null')
  }
  for (const key of ['-1', '01', 'a', '1.0', '2147483647']) {
    assert.equal(reason({ prefixUntil: 0, thenMap: { [key]: null } }), `thenMap key '${key}' must be a non-negative anchor number`)
  }
  for (const value of ['', '  \n', 3, undefined, {}]) {
    assert.equal(reason({ prefixUntil: 0, thenMap: { 4: value } }), 'thenMap[4] must be null or a non-blank summary string')
  }
  // 第一处：整数键先于字符串键（Object.keys 顺序）。
  assert.equal(reason({ prefixUntil: 0, thenMap: { b: null, 2: '' } }), 'thenMap[2] must be null or a non-blank summary string')
})

test('SPEC[compression-001] parseView never throws, even on accessor fields', () => {
  let reads = 0
  const sneaky = { thenMap: {} }
  Object.defineProperty(sneaky, 'prefixUntil', { enumerable: true, get: () => { reads++; return 0 } })
  const parsed = law.parseView(sneaky)
  assert.equal(parsed.ok, false)
  assert.match(parsed.reason, /Accessor field is not accepted: prefixUntil/)
  assert.equal(reads, 0)
})
