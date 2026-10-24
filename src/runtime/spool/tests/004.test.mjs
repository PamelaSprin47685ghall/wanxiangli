import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { OutputSpool } from 'wanxiangli/runtime'
import { directory, bytes, pattern } from './support.mjs'

test('SPEC[spool-004] readChunks streams the whole file in bounded chunks', async t => {
  const folder = directory(t)
  const file = path.join(folder, 'data.out')
  const data = pattern(1000003, 5)
  writeFileSync(file, data)
  const parts = []
  const result = await OutputSpool.readChunks(file, 65536, async chunk => {
    assert.ok(chunk.length <= 65536)
    parts.push(Buffer.from(chunk))
  })
  assert.deepEqual(result, { kind: 'Read', bytes: data.length })
  assert.ok(Buffer.concat(parts).equals(Buffer.from(data)))
  assert.throws(() => OutputSpool.readChunks(file, 0, () => {}))
  assert.throws(() => OutputSpool.readChunks('relative', 10, () => {}))
  assert.throws(() => OutputSpool.readChunks(file, 10, null))
  const missing = await OutputSpool.readChunks(path.join(folder, 'missing'), 10, () => {})
  assert.equal(missing.kind, 'Failed')
  assert.equal(missing.error.code, 'ENOENT')
})

test('SPEC[spool-004] readTail keeps the newest bytes and starts on a UTF-8 code point', async t => {
  const folder = directory(t)
  const file = path.join(folder, 'text.out')
  // 'a' then three-byte '中' repeated: any cut inside a character must move forward.
  const text = 'a' + '中'.repeat(1000)
  writeFileSync(file, text)
  const size = Buffer.byteLength(text)
  for (const limit of [1, 2, 3, 4, 5, 6, 7, 100, 101, 102]) {
    const tail = await OutputSpool.readTail(file, limit)
    assert.equal(tail.kind, 'Tail')
    assert.equal(tail.observed, size)
    assert.equal(tail.truncated, true)
    assert.equal(tail.discarded + tail.bytes.length, size)
    assert.ok(tail.bytes.length <= limit)
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(tail.bytes)
    assert.ok(text.endsWith(decoded))
    assert.equal(tail.bytes.length % 3, 0)
  }
  const whole = await OutputSpool.readTail(file, size)
  assert.equal(whole.truncated, false)
  assert.equal(whole.discarded, 0)
  assert.equal(new TextDecoder().decode(whole.bytes), text)
  const none = await OutputSpool.readTail(file, 0)
  assert.equal(none.bytes.length, 0)
  assert.equal(none.discarded, size)
})

test('SPEC[spool-004] binary tails are raw bytes: at most three continuation bytes are skipped', async t => {
  const folder = directory(t)
  const file = path.join(folder, 'binary.out')
  writeFileSync(file, new Uint8Array(64).fill(0x80))
  const tail = await OutputSpool.readTail(file, 10)
  assert.equal(tail.bytes.length, 7)
  assert.equal(tail.discarded, 57)
  const missing = await OutputSpool.readTail(path.join(folder, 'missing'), 10)
  assert.equal(missing.kind, 'Failed')
  assert.equal(missing.error.code, 'ENOENT')
})

test('SPEC[spool-004] a finished spool file reads back through the same readers', async t => {
  const folder = directory(t)
  const spool = new OutputSpool({ directory: folder, memoryBytes: 3 })
  spool.append('stdout', bytes('hello '))
  spool.append('stderr', bytes('世界'))
  const result = spool.finish()
  const tail = await OutputSpool.readTail(result.path, 4)
  assert.equal(new TextDecoder().decode(tail.bytes), '界')
  assert.equal(readFileSync(result.path, 'utf8'), 'hello 世界')
  spool.discard()
})
