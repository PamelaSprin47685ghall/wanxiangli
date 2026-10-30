import test from 'node:test'
import assert from 'node:assert/strict'

import { WarmStartLaw } from 'wanxiangli/warm-start'

const law = new WarmStartLaw()

const plain = (v) => JSON.parse(JSON.stringify(v))
const hint = (filePath, content, startLine = 1, endLine = 3) => ({ filePath, content, startLine, endLine })

test('SPEC[warm-start-1] keywords: explicit lines only, trimmed, blank-free, case-sensitive first wins, at most eight', () => {
  assert.equal(law.maxKeywords, 8)
  assert.deepEqual(law.normalizeKeywords(null), [])
  assert.deepEqual(law.normalizeKeywords(undefined), [])
  assert.deepEqual(law.normalizeKeywords(' \r\n\t \n'), [])
  assert.deepEqual(law.normalizeKeywords('  Alpha \r\nalpha\rAlpha\n\nbeta  '), ['Alpha', 'alpha', 'beta'])
  assert.deepEqual(law.normalizeKeywords(Array.from({ length: 12 }, (_, i) => `k${i % 10}`).join('\n')),
    ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'])
  // counterexample: duplicates do not consume the keyword budget
  assert.deepEqual(law.normalizeKeywords('a\na\na\na\na\na\na\na\nb'), ['a', 'b'])
  assert.throws(() => law.normalizeKeywords(42), /malformed keywords/)
})

test('SPEC[warm-start-2] each keyword keeps its first four hits ranked 1..4 by reference', () => {
  const hits = [1, 2, 3, 4, 5, 6].map(n => ({ n }))
  const ranked = law.rankHits(3, hits)
  assert.equal(ranked.length, law.topKPerKeyword)
  assert.deepEqual(ranked.map(r => [r.keywordOrdinal, r.localRank]), [[3, 1], [3, 2], [3, 3], [3, 4]])
  assert.equal(ranked[0].hit, hits[0])
  assert.deepEqual(law.rankHits(1, []), [])
})

test('SPEC[warm-start-3] select merges in ordinal order, de-duplicates stably and counts every omission', () => {
  const a = hint('a.fs', 'x'), a2 = hint('a.fs', 'x'), b = hint('b.fs', 'y'), aOther = hint('a.fs', 'x', 2, 3), aCase = hint('A.fs', 'x')
  const s2 = { ordinal: 2, hints: [a2, b] }, s1 = { ordinal: 1, hints: [a, aOther, aCase] }
  const out = law.select([s2, s1])
  assert.deepEqual(out.searches, [s1, s2])
  assert.equal(out.hints[0], a)
  assert.deepEqual(out.hints, [a, aOther, aCase, b])
  assert.equal(out.omitted, 1)
  const many = Array.from({ length: 8 }, (_, k) => ({ ordinal: k + 1, hints: [0, 1, 2, 3].map(i => hint(`f${k}`, `c${i}`)) }))
  const capped = law.select(many)
  assert.equal(capped.hints.length, law.maxHintsTotal)
  assert.equal(capped.omitted, 32 - 24)
  assert.equal(capped.hints.at(-1).filePath, 'f5')
  assert.deepEqual(plain(law.select([])), { searches: [], hints: [], omitted: 0 })
})

test('SPEC[warm-start-4] fit drops whole entries from the tail until the measured document fits', () => {
  assert.equal(law.maxWarmStartBytes, 65536)
  const calls = []
  const measure = (kept, omitted) => { calls.push([kept, omitted]); return 100 + kept * 30 + omitted }
  assert.deepEqual(plain(law.fit(5, 2, measure, 200)), { kept: 3, omitted: 4 })
  assert.deepEqual(calls, [[5, 2], [4, 3], [3, 4]])
  assert.deepEqual(plain(law.fit(5, 0, () => 65536)), { kept: 5, omitted: 0 })
  assert.deepEqual(plain(law.fit(2, 0, (k) => (k === 0 ? 10 : 99999))), { kept: 0, omitted: 2 })
  // counterexample: when the header alone does not fit, the caller must fall back rather than cut it
  assert.equal(law.fit(3, 1, () => 65537), null)
  assert.throws(() => law.fit(1, 0, () => 1.5), /malformed measure result/)
})

test('SPEC[warm-start-5] only Engineer and DevOps receive snippets', () => {
  assert.equal(law.isDirectConsumer('engineer'), true)
  assert.equal(law.isDirectConsumer('devops'), true)
  for (const role of ['manager', 'coder', 'inspector', 'Engineer', '']) assert.equal(law.isDirectConsumer(role), false)
})
