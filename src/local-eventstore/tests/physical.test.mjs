import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CanonicalEventCodec } from 'wanxiangli/events'
import {
  acquireLocalLock, appendLocalEvents, convergeLocalWriter, createLocalWriter,
  localWriterMetadata, readLocalStreams,
} from 'wanxiangli/local-eventstore'

const codec = new CanonicalEventCodec()
const event = (id, text, parents = []) => ({
  id, stream: 'physical', type: 'Add', parents, payload: { text }, payloadRefs: [],
})
const bytes = value => Buffer.from(codec.encode(value))
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'local-physical-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const directory = () => path.join(root, 'events')
  fs.mkdirSync(directory())
  return { root, directory, target: () => path.join(root, 'owner') }
}

test('legacy reorganization preserves bytes and activity while the active writer reselects its target', async t => {
  const f = fixture(t)
  const legacy = path.join(f.directory(), 'writer.ndjson')
  const first = event('a', 'first')
  const second = event('b', 'second', ['a'])
  const third = event('c', 'third', ['b'])
  fs.writeFileSync(legacy, bytes(first))
  const writer = createLocalWriter({ directory: f.directory, writerId: 'writer', segmentCap: 1 })
  assert.deepEqual(appendLocalEvents(writer, [second]), { ok: true, completion: 'durable' })
  assert.equal(writer.filePath(), legacy)
  const activity = Math.round(fs.statSync(legacy).mtimeMs)
  const lease = await acquireLocalLock(f.target)
  try {
    assert.deepEqual(convergeLocalWriter(f.directory, 'writer', 1), { ok: true })
  } finally {
    await lease.release()
  }
  assert.equal(fs.existsSync(legacy), false)
  assert.deepEqual(fs.readFileSync(path.join(f.directory(), 'writer-0000.ndjson')), bytes(first))
  assert.deepEqual(fs.readFileSync(path.join(f.directory(), 'writer-0001.ndjson')), bytes(second))
  assert.equal(Math.round(fs.statSync(path.join(f.directory(), 'writer-0001.ndjson')).mtimeMs), activity)
  assert.equal(localWriterMetadata(f.directory)[0].writerId, 'writer')
  assert.deepEqual(appendLocalEvents(writer, [third]), { ok: true, completion: 'durable' })
  assert.equal(path.basename(writer.filePath()), 'writer-0002.ndjson')
  const read = readLocalStreams(f.directory, Date.now())
  assert.equal(read.ok, true)
  assert.deepEqual(read.streams[0].events.map(value => value.id), ['a', 'b', 'c'])
})

test('an interrupted continuation resumes its exact copied prefix and refuses divergent bytes', async t => {
  const f = fixture(t)
  const first = event('a', 'first')
  const second = event('b', 'second', ['a'])
  const third = event('c', 'third', ['b'])
  const series = path.join(f.directory(), 'writer-0000.ndjson')
  const legacy = path.join(f.directory(), 'writer.ndjson')
  fs.writeFileSync(series, Buffer.concat([bytes(first), bytes(second)]))
  fs.writeFileSync(legacy, Buffer.concat([bytes(second), bytes(third)]))
  const lease = await acquireLocalLock(f.target)
  try {
    assert.deepEqual(convergeLocalWriter(f.directory, 'writer', 1), { ok: true })
    assert.equal(fs.existsSync(legacy), false)
    assert.deepEqual(fs.readFileSync(series), Buffer.concat([bytes(first), bytes(second)]))
    assert.deepEqual(fs.readFileSync(path.join(f.directory(), 'writer-0001.ndjson')), bytes(third))

    const conflicting = bytes(event('b', 'different bytes', ['a']))
    fs.writeFileSync(legacy, conflicting)
    const before = fs.readdirSync(f.directory()).sort().map(name => [name, fs.readFileSync(path.join(f.directory(), name))])
    assert.deepEqual(convergeLocalWriter(f.directory, 'writer', 1), { ok: false, reason: 'writer files diverged: writer' })
    assert.deepEqual(fs.readdirSync(f.directory()).sort().map(name => [name, fs.readFileSync(path.join(f.directory(), name))]), before)
  } finally {
    await lease.release()
  }
})

test('a partial legacy reassignment leaves its original bytes when the next segment write fails', async t => {
  const f = fixture(t)
  const legacy = path.join(f.directory(), 'writer.ndjson')
  const source = Buffer.concat([bytes(event('a', 'first')), bytes(event('b', 'second', ['a']))])
  fs.writeFileSync(legacy, source)
  const originalWrite = fs.writeFileSync
  const cause = new Error('second segment write failed')
  const failedPath = path.join(f.directory(), 'writer-0001.ndjson')
  const lease = await acquireLocalLock(f.target)
  fs.writeFileSync = function (target, ...rest) {
    if (target === failedPath) throw cause
    return originalWrite.call(this, target, ...rest)
  }
  try {
    assert.throws(() => convergeLocalWriter(f.directory, 'writer', 1), error => error === cause)
    assert.deepEqual(fs.readFileSync(legacy), source)
    assert.deepEqual(fs.readFileSync(path.join(f.directory(), 'writer-0000.ndjson')), bytes(event('a', 'first')))
    assert.equal(fs.existsSync(failedPath), false)
  } finally {
    fs.writeFileSync = originalWrite
    await lease.release()
  }
})
