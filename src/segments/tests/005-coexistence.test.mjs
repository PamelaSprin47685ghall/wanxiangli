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
  assert.equal(segments.coexistence(a, concat(a, b)), 'series', 'legacy is a prefix of the series')
  assert.equal(segments.coexistence(concat(a, b), concat(a, b)), 'series', 'equal bytes keep the series')
  assert.equal(segments.coexistence(new Uint8Array(), a), 'series')
  assert.equal(segments.coexistence(concat(a, b), a), 'legacy', 'the series is a prefix of legacy')
  assert.equal(segments.coexistence(concat(a, b.subarray(0, 5)), new Uint8Array()), 'legacy', 'an empty series is a prefix even of a half line')
  assert.equal(segments.coexistence(c, concat(a, b)), 'continuation', 'disjoint complete lines continue the series')
  assert.equal(segments.coexistence(concat(c, a), concat(a, b)), 'diverged', 'an overlapping id is divergence')
  assert.equal(segments.coexistence(c.subarray(0, c.length - 1), concat(a, b)), 'diverged', 'a half legacy line is not continuation')
  assert.equal(segments.coexistence(c, concat(a, b.subarray(0, 3))), 'diverged', 'a half series line is not continuation')
  assert.equal(segments.coexistence(concat(utf8('\ufeff'), c), a), 'diverged', 'BOM / non-canonical text is not continuation')
  assert.equal(segments.coexistence(utf8('\n'), a), 'diverged', 'an empty interior line is not continuation')
  assert.equal(segments.coexistence(Buffer.from(c), Buffer.from(a)), 'continuation', 'Node Buffers are byte arrays')
  assert.throws(() => segments.coexistence('x', a))
  assert.throws(() => segments.coexistence(a, [1]))
})

// Reference: the frozen read/reorganize verdict as the host wrote it twice, restated independently.
const referenceIds = bytes => {
  let text
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { return null }
  if (text.startsWith('\ufeff')) return null
  if (text === '') return new Set()
  if (!text.endsWith('\n')) return null
  const ids = new Set()
  for (const raw of text.slice(0, -1).split('\n')) {
    if (raw === '') return null
    const decoded = codec.tryDecode(raw + '\n')
    if (!decoded.ok) return null
    ids.add(decoded.event.id)
  }
  return ids
}
const startsWith = (prefix, full) => prefix.length <= full.length && prefix.every((byte, i) => byte === full[i])
const reference = (legacy, series) => {
  if (startsWith(legacy, series)) return 'series'
  if (startsWith(series, legacy)) return 'legacy'
  const l = referenceIds(legacy); const s = referenceIds(series)
  return l && s && [...l].every(id => !s.has(id)) ? 'continuation' : 'diverged'
}

test('SPEC[segments-7] the verdict equals the frozen law on 3000 seeded random form pairs', () => {
  let seed = 1919
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const pool = ['a', 'b', 'c', 'd', 'e'].map(id => utf8(line(id)))
  const pick = () => pool[Math.floor(random() * pool.length)]
  const form = () => {
    const parts = []
    const count = Math.floor(random() * 4)
    for (let i = 0; i < count; i += 1) parts.push(pick())
    let bytes = concat(...parts)
    const r = random()
    if (r < 0.1 && bytes.length > 0) bytes = bytes.subarray(0, Math.floor(random() * bytes.length))
    else if (r < 0.15) bytes = concat(bytes, utf8('\n'))
    else if (r < 0.2) bytes = concat(bytes, new Uint8Array([0xff, 0x0a]))
    return bytes
  }
  const tally = { series: 0, legacy: 0, continuation: 0, diverged: 0 }
  for (let round = 0; round < 3000; round += 1) {
    const series = form()
    const legacy = random() < 0.3 ? concat(series, form()) : random() < 0.5 ? series.subarray(0, Math.floor(random() * (series.length + 1))) : form()
    const actual = segments.coexistence(legacy, series)
    assert.equal(actual, reference(legacy, series), `round ${round}`)
    tally[actual] += 1
  }
  for (const kind of Object.keys(tally)) assert.ok(tally[kind] > 50, `${kind} covered: ${JSON.stringify(tally)}`)
})
