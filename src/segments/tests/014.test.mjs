import test from 'node:test'
import assert from 'node:assert/strict'

import { WriterSegments } from 'wanxiangli/segments'

const segments = new WriterSegments()

// Reference: the frozen durable-events-005/014 read law, written independently with ASCII digits.
const parse = name => {
  if (!name.endsWith('.ndjson')) return null
  const stem = name.slice(0, -'.ndjson'.length)
  const match = /^(.+)-([0-9]{4})$/.exec(stem)
  return match ? { writerId: match[1], ordinal: Number(match[2]) } : null
}
const reference = names => {
  const files = names.filter(name => name.endsWith('.ndjson')).sort()
  const ordinals = new Map()
  for (const name of files) {
    const parsed = parse(name)
    if (parsed) ordinals.set(parsed.writerId, [...(ordinals.get(parsed.writerId) ?? []), parsed.ordinal])
  }
  const series = new Set([...ordinals].filter(([, list]) => new Set(list).size === Math.max(...list) + 1).map(([writer]) => writer))
  const groups = new Map()
  for (const name of files) {
    const parsed = parse(name)
    const writer = parsed && series.has(parsed.writerId) ? parsed.writerId : name.slice(0, -'.ndjson'.length)
    groups.set(writer, [...(groups.get(writer) ?? []), name])
  }
  return [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([writerId, fileNames]) => ({ writerId, fileNames: fileNames.sort() }))
}

const seeded = seed => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

test('SPEC[segments-3] grouping keeps contiguous series, demotes broken ones to legacy stems, ignores non-ndjson', () => {
  const names = [
    'a-0000.ndjson', 'a-0001.ndjson', 'a.ndjson', // series with coexisting legacy
    'b-0000.ndjson', 'b-0002.ndjson', // gap: each file is its own legacy-stem writer
    'c-0001.ndjson', // does not start at 0000
    'd.ndjson', 'notes.txt', 'e-٠٠٠٠.ndjson', '-0000.ndjson',
  ]
  assert.deepEqual(segments.groupWriterFiles(names), [
    { writerId: '-0000', fileNames: ['-0000.ndjson'] },
    { writerId: 'a', fileNames: ['a-0000.ndjson', 'a-0001.ndjson', 'a.ndjson'] },
    { writerId: 'b-0000', fileNames: ['b-0000.ndjson'] },
    { writerId: 'b-0002', fileNames: ['b-0002.ndjson'] },
    { writerId: 'c-0001', fileNames: ['c-0001.ndjson'] },
    { writerId: 'd', fileNames: ['d.ndjson'] },
    { writerId: 'e-٠٠٠٠', fileNames: ['e-٠٠٠٠.ndjson'] },
  ])
  assert.deepEqual(segments.groupWriterFiles([]), [])
  assert.throws(() => segments.groupWriterFiles('a.ndjson'))
  assert.throws(() => segments.groupWriterFiles([1]))
})

test('SPEC[segments-3] grouping equals the reference law on 400 seeded name lists and ignores input order', () => {
  const random = seeded(19)
  const writers = ['w', 'w-0000', 'x-y', 'z', '٣', 'a-0001-0000']
  const tails = ['', '-0000', '-0001', '-0002', '-0003', '-9999', '-٠٠٠٠', '-000', '-10000']
  for (let round = 0; round < 400; round += 1) {
    const names = new Set()
    const count = Math.floor(random() * 12)
    for (let index = 0; index < count; index += 1) {
      const writer = writers[Math.floor(random() * writers.length)]
      const tail = tails[Math.floor(random() * tails.length)]
      names.add(writer + tail + (random() < 0.9 ? '.ndjson' : '.tmp'))
    }
    const list = [...names]
    const expected = reference(list)
    assert.deepEqual(segments.groupWriterFiles(list), expected, JSON.stringify(list))
    assert.deepEqual(segments.groupWriterFiles([...list].reverse()), expected)
  }
})

test('SPEC[segments-4] stream layout names each form of one writer group', () => {
  assert.deepEqual(segments.streamLayout({ writerId: 'a', fileNames: ['a-0001.ndjson', 'a-0000.ndjson'] }), { kind: 'segments', segments: ['a-0000.ndjson', 'a-0001.ndjson'] })
  assert.deepEqual(segments.streamLayout({ writerId: 'a', fileNames: ['a.ndjson'] }), { kind: 'legacy', legacy: 'a.ndjson' })
  assert.deepEqual(segments.streamLayout({ writerId: 'a', fileNames: ['a.ndjson', 'a-0000.ndjson'] }), { kind: 'coexisting', legacy: 'a.ndjson', segments: ['a-0000.ndjson'] })
  assert.deepEqual(segments.streamLayout({ writerId: 'b-0002', fileNames: ['b-0002.ndjson'] }), { kind: 'legacy', legacy: 'b-0002.ndjson' })
  assert.deepEqual(segments.streamLayout({ writerId: 'a', fileNames: ['a.ndjson', 'b.ndjson'] }), { kind: 'multipleLegacy', legacy: ['a.ndjson', 'b.ndjson'] })
  for (const group of segments.groupWriterFiles(['a-0000.ndjson', 'a.ndjson', 'b-0001.ndjson', 'c.ndjson'])) {
    assert.notEqual(segments.streamLayout(group).kind, 'multipleLegacy', group.writerId)
  }
  assert.throws(() => segments.streamLayout(null))
  assert.throws(() => segments.streamLayout({ writerId: 1, fileNames: [] }))
})
