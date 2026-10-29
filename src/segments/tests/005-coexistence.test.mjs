import test from 'node:test'
import assert from 'node:assert/strict'

import { CanonicalEventCodec } from 'wanxiangli/events'
import { WriterSegments } from 'wanxiangli/segments'

const segments = new WriterSegments()
const codec = new CanonicalEventCodec()
const utf8 = text => new TextEncoder().encode(text)
const line = id => codec.encode({ id, stream: 's', type: 't', parents: [], payload: { n: id }, payloadRefs: [] })
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) { out.set(part, at); at += part.length }
  return out
}

test('SPEC[segments-7] a copied canonical prefix at the series tail resumes at the first missing line', () => {
  const original = utf8(line('a') + line('b'))
  const legacy = utf8(line('c') + line('d') + line('e'))
  for (const copiedLines of [1, 2, 3]) {
    const copied = utf8(['c', 'd', 'e'].slice(0, copiedLines).map(line).join(''))
    assert.deepEqual(segments.coexistence(legacy, concat(original, copied)), { kind: 'continuation', copiedLines })
  }
})

test('SPEC[segments-7] copied IDs need exact bytes and cannot hide old IDs in the remaining suffix', () => {
  const changed = utf8(codec.encode({ id: 'c', stream: 's', type: 't', parents: [], payload: { n: 'changed' }, payloadRefs: [] }))
  assert.deepEqual(segments.coexistence(utf8(line('c') + line('d')), concat(utf8(line('a')), changed)), { kind: 'diverged' })
  assert.deepEqual(segments.coexistence(utf8(line('c') + line('a')), utf8(line('a') + line('b') + line('c'))), { kind: 'diverged' })
})

test('SPEC[segments-6] a writer stream is complete canonical lines, framed and decoded once', () => {
  assert.deepEqual(segments.decodeStream('w', ''), { ok: true, events: [] })
  const decoded = segments.decodeStream('w', line('a') + line('b'))
  assert.equal(decoded.ok, true)
  assert.deepEqual(decoded.events.map(event => event.id), ['a', 'b'])
  assert.deepEqual(segments.decodeStream('w.ndjson', line('a') + line('b').slice(0, -1)),
    { ok: false, error: { code: 'NonCanonical', reason: 'writer file has incomplete trailing line: w.ndjson' } })
  assert.deepEqual(segments.decodeStream('w.ndjson', line('a') + '\n' + line('b')),
    { ok: false, error: { code: 'NonCanonical', reason: 'writer file contains empty interior line: w.ndjson' } })
  const bad = segments.decodeStream('w', line('a') + '{"id":"x"}\n' + line('b'))
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.error, codec.tryDecode('{"id":"x"}\n').error, 'line faults come from wanxiangli/events unchanged')
  assert.throws(() => segments.decodeStream('w', utf8('')))
  assert.throws(() => segments.decodeStream(1, ''))
})

test('SPEC[segments-7] coexisting forms: prefix keeps the longer form, disjoint complete lines continue, else diverged', () => {
  const a = utf8(line('a')); const b = utf8(line('b')); const c = utf8(line('c'))
  assert.deepEqual(segments.coexistence(a, concat(a, b)), { kind: 'series' }, 'legacy is a prefix of the series')
  assert.deepEqual(segments.coexistence(concat(a, b), concat(a, b)), { kind: 'series' }, 'equal bytes keep the series')
  assert.deepEqual(segments.coexistence(new Uint8Array(), a), { kind: 'series' })
  assert.deepEqual(segments.coexistence(concat(a, b), a), { kind: 'legacy' }, 'the series is a prefix of legacy')
  assert.deepEqual(segments.coexistence(concat(a, b.subarray(0, 5)), new Uint8Array()), { kind: 'legacy' }, 'an empty series is a prefix even of a half line')
  assert.deepEqual(segments.coexistence(c, concat(a, b)), { kind: 'continuation', copiedLines: 0 }, 'disjoint complete lines continue the series')
  assert.deepEqual(segments.coexistence(concat(c, a), concat(a, b)), { kind: 'diverged' }, 'an overlapping id is divergence')
  assert.deepEqual(segments.coexistence(c.subarray(0, c.length - 1), concat(a, b)), { kind: 'diverged' }, 'a half legacy line is not continuation')
  assert.deepEqual(segments.coexistence(c, concat(a, b.subarray(0, 3))), { kind: 'diverged' }, 'a half series line is not continuation')
  assert.deepEqual(segments.coexistence(concat(utf8('\ufeff'), c), a), { kind: 'diverged' }, 'BOM / non-canonical text is not continuation')
  assert.deepEqual(segments.coexistence(utf8('\n'), a), { kind: 'diverged' }, 'an empty interior line is not continuation')
  assert.deepEqual(segments.coexistence(Buffer.from(c), Buffer.from(a)), { kind: 'continuation', copiedLines: 0 }, 'Node Buffers are byte arrays')
  assert.throws(() => segments.coexistence('x', a))
  assert.throws(() => segments.coexistence(a, [1]))
})

test('SPEC[segments-7] constructed forms preserve each recovery case across 3000 seeded samples', () => {
  let seed = 1919
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (let round = 0; round < 3000; round += 1) {
    const count = 1 + Math.floor(random() * 8)
    const original = utf8(Array.from({ length: count }, (_, index) => line(`original-${round}-${index}`)).join(''))
    const legacyLines = Array.from({ length: count }, (_, index) => line(`legacy-${round}-${index}`))
    const legacy = utf8(legacyLines.join(''))
    const copiedLines = 1 + Math.floor(random() * count)
    const partial = concat(original, utf8(legacyLines.slice(0, copiedLines).join('')))
    assert.deepEqual(segments.coexistence(original, concat(original, legacy)), { kind: 'series' })
    assert.deepEqual(segments.coexistence(concat(original, legacy), original), { kind: 'legacy' })
    assert.deepEqual(segments.coexistence(legacy, original), { kind: 'continuation', copiedLines: 0 })
    assert.deepEqual(segments.coexistence(legacy, partial), { kind: 'continuation', copiedLines })
    assert.deepEqual(segments.coexistence(concat(legacy, original), original), { kind: 'diverged' })
    assert.deepEqual(segments.coexistence(legacy.subarray(0, legacy.length - 1), partial), { kind: 'diverged' })
    assert.deepEqual(segments.coexistence(legacy, concat(original, new Uint8Array([0xff, 0x0a]))), { kind: 'diverged' })
  }
})
