import test from 'node:test'
import assert from 'node:assert/strict'

import { WriterSegments } from 'wanxiangli/segments'

const segments = new WriterSegments()

test('SPEC[segments-1] only exactly four ASCII digits name a segment', () => {
  assert.deepEqual(segments.parseSegmentFileName('w-0000.ndjson'), { writerId: 'w', ordinal: 0 })
  assert.deepEqual(segments.parseSegmentFileName('a-b-0042.ndjson'), { writerId: 'a-b', ordinal: 42 })
  assert.deepEqual(segments.parseSegmentFileName('w-9999.ndjson'), { writerId: 'w', ordinal: 9999 })
  for (const name of [
    'w-٠٠٠٠.ndjson', // Arabic-Indic digits are Unicode Nd but not segment ordinals
    'w-０００１.ndjson', // fullwidth digits
    'w-000.ndjson', 'w-10000.ndjson', 'w-0000.json', 'w-0000.ndjson.tmp', 'w0000.ndjson',
    '-0000.ndjson', 'w.ndjson', '.ndjson', 'w-00a0.ndjson',
  ]) assert.equal(segments.parseSegmentFileName(name), null, name)
  assert.throws(() => segments.parseSegmentFileName(7))
})

test('SPEC[segments-2] ordinals outside 0..9999 refuse instead of spelling another writer', () => {
  assert.equal(segments.segmentFileName('w', 0), 'w-0000.ndjson')
  assert.equal(segments.segmentFileName('w', 9999), 'w-9999.ndjson')
  assert.equal(segments.maxOrdinal, 9999)
  for (const ordinal of [10000, -1, 1.5, NaN, Infinity, '1', null]) {
    assert.throws(() => segments.segmentFileName('w', ordinal), String(ordinal))
  }
  for (const ordinal of [0, 7, 9999]) {
    const name = segments.segmentFileName('writer-x', ordinal)
    assert.deepEqual(segments.parseSegmentFileName(name), { writerId: 'writer-x', ordinal })
  }
  assert.equal(segments.legacyFileName('w'), 'w.ndjson')
})

test('SPEC[segments-5] writer ids that would collide with segment names are named', () => {
  assert.equal(segments.writerIdFault('writer-a'), null)
  assert.equal(segments.writerIdFault('w-٠٠٠٠'), null, 'non-ASCII digits cannot collide with a segment name')
  assert.equal(segments.writerIdFault(''), 'required')
  assert.equal(segments.writerIdFault('   '), 'required')
  assert.equal(segments.writerIdFault(undefined), 'required')
  for (const id of ['a/b', 'a\\b', '.', '..']) assert.equal(segments.writerIdFault(id), 'pathSegment', id)
  assert.equal(segments.writerIdFault('w-0001'), 'segmentSuffix')
  // Naming is not creation: a legacy stem demoted from a broken series still names its own series.
  assert.equal(segments.segmentFileName('b-0002', 0), 'b-0002-0000.ndjson')
  assert.deepEqual(segments.parseSegmentFileName('b-0002-0000.ndjson'), { writerId: 'b-0002', ordinal: 0 })
  assert.throws(() => segments.segmentFileName('', 0), /required/)
  assert.throws(() => segments.legacyFileName('a/b'), /pathSegment/)
  assert.throws(() => segments.legacyFileName(3))
})

test('SPEC[segments-1] a writer series is every own segment, gaps included, and nothing else', () => {
  const names = ['w-0002.ndjson', 'w.ndjson', 'w-0000.ndjson', 'ww-0001.ndjson', 'w-x-0000.ndjson', 'w-٠٠٠١.ndjson', 'notes.txt']
  assert.deepEqual(segments.seriesOf('w', names), ['w-0000.ndjson', 'w-0002.ndjson'])
  assert.deepEqual(segments.seriesOf('w-x', names), ['w-x-0000.ndjson'])
})
