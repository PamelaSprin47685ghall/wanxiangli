import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { OutputSpool } from 'wanxiangli/runtime'
import { directory, entries, bytes, pattern } from './support.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')

test('SPEC[spool-002] crossing memoryBytes moves every earlier byte to one file in arrival order', t => {
  const folder = directory(t)
  const spool = new OutputSpool({ directory: folder, memoryBytes: 6 })
  assert.deepEqual(spool.append('stdout', bytes('out1')), { kind: 'Memory' })
  assert.deepEqual(spool.append('stderr', bytes('er')), { kind: 'Memory' })
  assert.equal(spool.inspect().held, 6)
  assert.deepEqual(spool.append('stdout', bytes('X')), { kind: 'File' })
  assert.deepEqual(spool.append('stderr', bytes('tail')), { kind: 'File' })
  const state = spool.inspect()
  assert.equal(state.held, 0)
  assert.equal(state.written, 11)
  assert.equal(path.dirname(state.path), folder)
  const result = spool.finish()
  assert.deepEqual(result, { kind: 'File', observed: 11, path: state.path, bytes: 11 })
  assert.equal(readFileSync(result.path, 'utf8'), 'out1erXtail')
  assert.equal(statSync(result.path).mode & 0o777, 0o600)
  assert.deepEqual(spool.discard(), { kind: 'Removed' })
  assert.equal(existsSync(result.path), false)
  assert.deepEqual(spool.discard(), { kind: 'Absent' })
  assert.deepEqual(entries(folder), [])
})

test('SPEC[spool-002] large chunked output keeps memory bounded and loses no byte', t => {
  const folder = directory(t)
  const spool = new OutputSpool({ directory: folder, memoryBytes: 1024 })
  const all = []
  let maximumHeld = 0
  for (let i = 0; i < 2600; i++) {
    const chunk = pattern(4096 + (i % 7), i)
    all.push(chunk)
    spool.append(i % 3 === 0 ? 'stderr' : 'stdout', chunk)
    maximumHeld = Math.max(maximumHeld, spool.inspect().held)
  }
  assert.ok(maximumHeld <= 1024, String(maximumHeld))
  const result = spool.finish()
  const expected = Buffer.concat(all)
  assert.ok(expected.length > 10 * 1024 * 1024)
  assert.equal(result.kind, 'File')
  assert.equal(result.bytes, expected.length)
  assert.equal(result.observed, expected.length)
  assert.equal(digest(readFileSync(result.path)), digest(expected))
  spool.discard()
})

test('SPEC[spool-002] real child process output is preserved byte for byte, including invalid UTF-8', async t => {
  const folder = directory(t)
  const spool = new OutputSpool({ directory: folder, memoryBytes: 65536 })
  const script = `
    const out = new Uint8Array(3 * 1024 * 1024)
    for (let i = 0; i < out.length; i++) out[i] = (i * 7) & 0xff
    process.stdout.write(out, () => process.stderr.write(Buffer.from([0xff, 0xfe, 0xe4, 0xb8])))
  `
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
  const seen = []
  child.stdout.on('data', chunk => { seen.push(Buffer.from(chunk)); spool.append('stdout', new Uint8Array(chunk)) })
  child.stderr.on('data', chunk => { seen.push(Buffer.from(chunk)); spool.append('stderr', new Uint8Array(chunk)) })
  const code = await new Promise(resolve => child.on('close', resolve))
  assert.equal(code, 0)
  const result = spool.finish()
  assert.equal(result.kind, 'File')
  assert.equal(result.bytes, 3 * 1024 * 1024 + 4)
  assert.equal(digest(readFileSync(result.path)), digest(Buffer.concat(seen)))
  spool.discard()
})
