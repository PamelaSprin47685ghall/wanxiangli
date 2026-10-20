import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, rmdirSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OutputSpool } from 'wanxiangli/spool'
import { directory, entries, bytes, pattern } from './support.mjs'

const root = process.getuid?.() === 0

test('SPEC[spool-003] a directory that refuses the file yields Failed, not a complete result', { skip: root && 'root ignores directory permissions' }, t => {
  const folder = directory(t)
  const locked = path.join(folder, 'locked')
  mkdirSync(locked)
  chmodSync(locked, 0o500)
  const spool = new OutputSpool({ directory: locked, memoryBytes: 4 })
  assert.deepEqual(spool.append('stdout', bytes('abcd')), { kind: 'Memory' })
  const failed = spool.append('stdout', bytes('e'))
  assert.equal(failed.kind, 'Failed')
  assert.equal(failed.error.operation, 'open')
  assert.equal(failed.error.code, 'EACCES')
  assert.equal(spool.append('stderr', bytes('more')).kind, 'Failed')
  const state = spool.inspect()
  assert.equal(state.held, 0)
  assert.equal(state.observed, 9)
  const result = spool.finish()
  assert.equal(result.kind, 'Failed')
  assert.equal(result.observed, 9)
  assert.equal(result.written, 0)
  assert.equal(result.path, null)
  assert.deepEqual(spool.discard(), { kind: 'Absent' })
  assert.deepEqual(entries(locked), [])
  chmodSync(locked, 0o700)
})

test('SPEC[spool-003] a removed directory is reported with its real error code', t => {
  const folder = directory(t)
  const gone = path.join(folder, 'gone')
  mkdirSync(gone)
  const spool = new OutputSpool({ directory: gone, memoryBytes: 1 })
  rmdirSync(gone)
  const failed = spool.append('stdout', bytes('xy'))
  assert.equal(failed.kind, 'Failed')
  assert.equal(failed.error.code, 'ENOENT')
  assert.equal(spool.finish().kind, 'Failed')
})

test('SPEC[spool-003] a write that fails midway reports exactly the bytes that reached the file', t => {
  const folder = directory(t)
  const worker = fileURLToPath(new URL('./limit-worker.mjs', import.meta.url))
  // RLIMIT_FSIZE makes the kernel refuse writes past the limit with EFBIG: a real
  // midway failure, not an exception thrown by the test.
  const run = spawnSync('sh', ['-c', 'ulimit -f 4 && exec "$0" "$1" "$2"', process.execPath, worker, folder],
    { encoding: 'utf8', timeout: 30000 })
  assert.equal(run.status, 0, run.stderr)
  const report = JSON.parse(run.stdout)
  assert.equal(report.result.kind, 'Failed')
  assert.equal(report.result.error.operation, 'write')
  assert.equal(report.result.error.code, 'EFBIG')
  assert.equal(report.result.observed, 20000)
  assert.ok(report.result.written > 0 && report.result.written < 20000, JSON.stringify(report.result))
  assert.equal(report.size, report.result.written)
  assert.deepEqual(report.discard, { kind: 'Removed' })
  assert.deepEqual(entries(folder), [])
})
