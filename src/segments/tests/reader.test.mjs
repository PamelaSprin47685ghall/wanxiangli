import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { CanonicalEventCodec } from 'wanxiangli/events'
import { SegmentedReader, SegmentedWriter } from 'wanxiangli/segments'

const codec = new CanonicalEventCodec()
const now = Date.UTC(2026, 10, 1, 12)
const line = (id, type = 'JournalEnvelope', payload = { ObservedAt: new Date(now).toISOString() }) =>
  codec.encode({ id, stream: 's', type, parents: [], payload, payloadRefs: [] })

function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'wanxiangli-segmented-reader-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let calls = 0
  const directory = () => { calls++; return root }
  const reader = new SegmentedReader()
  const put = (name, bytes) => {
    const target = path.join(root, name)
    fs.writeFileSync(target, bytes)
    fs.utimesSync(target, now / 1000, now / 1000)
    return target
  }
  return { root, directory, reader, put, calls: () => calls, reset: () => { calls = 0 } }
}

function ids(result) {
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.streams.map(stream => [stream.writerId, stream.events.map(event => event.id)])
}

function watchFds(t) {
  const open = fs.openSync
  const close = fs.closeSync
  const live = new Set()
  const opened = []
  t.mock.method(fs, 'openSync', (...args) => {
    const fd = open(...args)
    live.add(fd)
    opened.push(String(args[0]))
    return fd
  })
  t.mock.method(fs, 'closeSync', fd => { close(fd); live.delete(fd) })
  return { live, opened }
}

test('reader reads canonical writer output, continuous segments and legacy name boundaries', t => {
  const f = fixture(t)
  const writer = new SegmentedWriter({ directory: f.directory, writerId: 'z', segmentCap: 1 })
  assert.deepEqual(writer.append(line('z1')), { ok: true, completion: 'durable' })
  assert.deepEqual(writer.append(line('z2')), { ok: true, completion: 'durable' })
  f.put('a.ndjson', line('a'))
  f.put('gap-0002.ndjson', line('gap'))
  f.put('wide-００００.ndjson', line('wide'))
  f.put('ignored.txt', 'not an event')
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [
    ['a', ['a']], ['gap-0002', ['gap']], ['wide-００００', ['wide']], ['z', ['z1', 'z2']],
  ])
})

test('directory is queried at enumeration and each use, including coexistence selection', t => {
  const f = fixture(t)
  assert.equal(f.calls(), 0)
  f.put('w.ndjson', line('a'))
  assert.equal(f.reader.writerPhysicalMetadata(f.directory).length, 1)
  assert.equal(f.calls(), 2)
  f.reset()
  assert.match(f.reader.physicalInventory(f.directory), /^w\[w\.ndjson=/)
  assert.equal(f.calls(), 2)
  f.reset()
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [['w', ['a']]])
  assert.equal(f.calls(), 3)
  f.put('w-0000.ndjson', line('a') + line('b'))
  f.reset()
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [['w', ['a', 'b']]])
  assert.equal(f.calls(), 5)
  const dynamic = fixture(t)
  dynamic.put('w.ndjson', line('first'))
  const other = path.join(dynamic.root, 'other')
  fs.mkdirSync(other)
  fs.writeFileSync(path.join(other, 'w.ndjson'), line('other'))
  let calls = 0
  assert.deepEqual(ids(new SegmentedReader().readStreams(() => ++calls === 1 ? dynamic.root : other, now)), [['w', ['other']]])
  assert.equal(calls, 3)
})

test('exact cache hits avoid full reads; growth decodes only the suffix; failed suffix does not advance cache', t => {
  const f = fixture(t)
  const target = f.put('w.ndjson', line('a'))
  const read = fs.readFileSync
  let fullReads = 0
  t.mock.method(fs, 'readFileSync', (...args) => { if (args[0] === target) fullReads++; return read(...args) })
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [['w', ['a']]])
  assert.equal(fullReads, 1)
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [['w', ['a']]])
  assert.equal(fullReads, 1)
  fs.appendFileSync(target, line('b'))
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [['w', ['a', 'b']]])
  assert.equal(fullReads, 1)
  const c = line('c')
  fs.appendFileSync(target, c.slice(0, -1))
  assert.equal(f.reader.readStreams(f.directory, now).ok, false)
  fs.appendFileSync(target, '\n')
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [['w', ['a', 'b', 'c']]])
  assert.equal(fullReads, 1)
})

test('truncate, equal-length rewrite and inode replacement discard the old decoded prefix', t => {
  const f = fixture(t)
  const target = f.put('w.ndjson', line('a') + line('b'))
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [['w', ['a', 'b']]])
  f.put('w.ndjson', line('c'))
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [['w', ['c']]])
  assert.equal(Buffer.byteLength(line('c')), Buffer.byteLength(line('d')))
  f.put('w.ndjson', line('d'))
  fs.utimesSync(target, now / 1000 + 1, now / 1000 + 1)
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [['w', ['d']]])
  fs.renameSync(f.put('replacement', line('e')), target)
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [['w', ['e']]])
  fs.unlinkSync(target)
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [])
  f.put('w.ndjson', line('f'))
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [['w', ['f']]])
})

test('coexisting forms choose complete bytes and skip an already copied continuation prefix without rewriting files', t => {
  for (const [legacy, series, expected] of [
    [line('a'), line('a') + line('b'), ['a', 'b']],
    [line('a') + line('b'), line('a'), ['a', 'b']],
    [line('c') + line('d'), line('a') + line('b') + line('c'), ['a', 'b', 'c', 'd']],
  ]) {
    const f = fixture(t)
    const old = f.put('w.ndjson', legacy)
    const segment = f.put('w-0000.ndjson', series)
    assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [['w', expected]])
    assert.equal(fs.readFileSync(old, 'utf8'), legacy)
    assert.equal(fs.readFileSync(segment, 'utf8'), series)
  }
  const f = fixture(t)
  f.put('w.ndjson', line('a', 'JournalEnvelope', { ObservedAt: new Date(now).toISOString(), changed: true }))
  f.put('w-0000.ndjson', line('a'))
  const result = f.reader.readStreams(f.directory, now)
  assert.equal(result.ok, false)
  assert.match(result.error.reason, /writer files diverged: w/)
})

test('expired corrupt writers are filtered before decoding; retained malformed streams return codec errors', t => {
  const f = fixture(t)
  const old = f.put('old.ndjson', Buffer.from([0xff, 10]))
  fs.utimesSync(old, (now - 4 * 86400000) / 1000, (now - 4 * 86400000) / 1000)
  f.put('current.ndjson', line('current'))
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [['current', ['current']]])
  for (const bytes of [Buffer.from([0xff, 10]), line('a').slice(0, -1), line('a') + '\n' + line('b')]) {
    f.put('bad.ndjson', bytes)
    assert.equal(f.reader.readStreams(f.directory, now).ok, false)
  }
})

test('activity walks cut tails across segments, stops at the first observation and closes every opened fd', t => {
  const f = fixture(t)
  f.put('w-0000.ndjson', line('unread'))
  f.put('w-0001.ndjson', line('seen'))
  f.put('w-0002.ndjson', line('cut', 'ProjectionCutTail', {}))
  const fds = watchFds(t)
  assert.deepEqual(f.reader.writerPhysicalMetadata(f.directory), [{
    writerId: 'w', fileNames: ['w-0000.ndjson', 'w-0001.ndjson', 'w-0002.ndjson'], lastActivityMs: now,
  }])
  assert.deepEqual(fds.opened.map(file => path.basename(file)), ['w-0002.ndjson', 'w-0001.ndjson'])
  assert.equal(fds.live.size, 0)
})

test('unusable tails and read failures fall back to rounded maximum mtime and release fds', t => {
  const f = fixture(t)
  f.put('w-0000.ndjson', line('old', 'JournalEnvelope', { ObservedAt: '2000-01-01T00:00:00.000Z' }))
  const fds = watchFds(t)
  for (const bytes of ['', 'half', Buffer.from([0xff, 10]), '\n']) {
    f.put('w-0001.ndjson', bytes)
    assert.equal(f.reader.writerPhysicalMetadata(f.directory)[0].lastActivityMs, now)
    assert.equal(fds.live.size, 0)
  }
  f.put('w-0001.ndjson', line('current'))
  t.mock.method(fs, 'readSync', () => { throw new Error('tail read failed') })
  assert.equal(f.reader.writerPhysicalMetadata(f.directory)[0].lastActivityMs, now)
  assert.equal(fds.live.size, 0)
})

test('metadata open errors still throw; inventory reports unavailable; incremental read errors close the fd', t => {
  const f = fixture(t)
  const target = f.put('w.ndjson', line('a'))
  assert.deepEqual(ids(f.reader.readStreams(f.directory, now)), [['w', ['a']]])
  const originalLength = fs.statSync(target).size
  const appended = line('b')
  fs.appendFileSync(target, appended)
  const fds = watchFds(t)
  const read = fs.readSync
  t.mock.method(fs, 'readSync', (...args) => {
    if (args[4] === originalLength && args[3] === Buffer.byteLength(appended)) throw new Error('suffix read failed')
    return read(...args)
  })
  const result = f.reader.readStreams(f.directory, now)
  assert.equal(result.ok, false)
  assert.match(result.error.reason, /writer read failed: suffix read failed/)
  assert.equal(fds.live.size, 0)
  const cause = new Error('open refused')
  t.mock.method(fs, 'openSync', () => { throw cause })
  assert.throws(() => f.reader.writerPhysicalMetadata(f.directory), error => error === cause)
  assert.equal(f.reader.physicalInventory(() => { throw cause }), 'inventory-unavailable')
})
