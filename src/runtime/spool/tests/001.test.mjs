import test from 'node:test'
import assert from 'node:assert/strict'
import { OutputSpool } from 'wanxiangli/runtime'
import { directory, entries, bytes } from './support.mjs'

test('SPEC[spool-001] invalid options are rejected before any file is created', t => {
  const folder = directory(t)
  const invalid = [
    undefined, null, [], { directory: folder }, { memoryBytes: 1 },
    { directory: 'relative', memoryBytes: 1 }, { directory: '', memoryBytes: 1 },
    { directory: folder + '\0', memoryBytes: 1 }, { directory: folder, memoryBytes: -1 },
    { directory: folder, memoryBytes: 1.5 }, { directory: folder, memoryBytes: '10' },
    { directory: folder, memoryBytes: 16777217 }, { directory: folder, memoryBytes: 1, extra: true },
  ]
  for (const options of invalid) assert.throws(() => new OutputSpool(options), JSON.stringify(options))
  assert.throws(() => new OutputSpool(Object.create({ directory: folder, memoryBytes: 1 })))
  assert.throws(() => new OutputSpool({ get directory() { return folder }, memoryBytes: 1 }))
  assert.deepEqual(entries(folder), [])
})

test('SPEC[spool-001] invalid appends are rejected and do not count as output', t => {
  const spool = new OutputSpool({ directory: directory(t), memoryBytes: 64 })
  assert.throws(() => spool.append('combined', bytes('x')))
  assert.throws(() => spool.append('stdout', 'text'))
  assert.throws(() => spool.append('stdout', [1, 2]))
  assert.throws(() => spool.append('stdout', new Uint8Array(new SharedArrayBuffer(4))))
  assert.equal(spool.inspect().observed, 0)
})

test('SPEC[spool-001] output within memoryBytes stays in memory with each channel byte-exact', t => {
  const folder = directory(t)
  const spool = new OutputSpool({ directory: folder, memoryBytes: 8 })
  const first = bytes('abc')
  assert.deepEqual(spool.append('stdout', first), { kind: 'Memory' })
  first[0] = 0x7a
  assert.deepEqual(spool.append('stderr', bytes('ERR')), { kind: 'Memory' })
  assert.deepEqual(spool.append('stdout', bytes('de')), { kind: 'Memory' })
  assert.deepEqual(spool.append('stdout', new Uint8Array(0)), { kind: 'Memory' })
  assert.deepEqual(spool.inspect(), { phase: 'Memory', observed: 8, written: 0, held: 8, path: null, failure: null })
  const result = spool.finish()
  assert.equal(result.kind, 'Memory')
  assert.equal(result.observed, 8)
  assert.equal(new TextDecoder().decode(result.stdout), 'abcde')
  assert.equal(new TextDecoder().decode(result.stderr), 'ERR')
  result.stdout[0] = 0
  assert.equal(new TextDecoder().decode(spool.finish().stdout), 'abcde')
  assert.equal(spool.inspect().phase, 'Finished')
  assert.deepEqual(spool.append('stdout', bytes('late')), { kind: 'Finished' })
  assert.equal(spool.inspect().observed, 8)
  assert.deepEqual(spool.discard(), { kind: 'Absent' })
  assert.deepEqual(entries(folder), [])
})

test('SPEC[spool-001] zero memoryBytes holds nothing in memory and empty output stays empty', t => {
  const folder = directory(t)
  const empty = new OutputSpool({ directory: folder, memoryBytes: 0 })
  const result = empty.finish()
  assert.equal(result.kind, 'Memory')
  assert.equal(result.stdout.length + result.stderr.length, 0)
  const spool = new OutputSpool({ directory: folder, memoryBytes: 0 })
  assert.deepEqual(spool.append('stdout', bytes('x')), { kind: 'File' })
  assert.equal(spool.inspect().held, 0)
  const file = spool.finish()
  assert.equal(file.kind, 'File')
  assert.equal(file.bytes, 1)
  assert.deepEqual(spool.discard(), { kind: 'Removed' })
})

test('SPEC[spool-001] instances are isolated and expose no native handle', t => {
  const folder = directory(t)
  const a = new OutputSpool({ directory: folder, memoryBytes: 2 })
  const b = new OutputSpool({ directory: folder, memoryBytes: 2 })
  a.append('stdout', bytes('aaaa'))
  b.append('stdout', bytes('b'))
  assert.equal(a.inspect().phase, 'File')
  assert.equal(b.inspect().phase, 'Memory')
  assert.deepEqual(Object.keys(a).sort(), ['append', 'discard', 'finish', 'inspect'])
  const state = a.inspect()
  state.observed = 0
  assert.equal(a.inspect().observed, 4)
  a.discard()
  assert.deepEqual(entries(folder), [])
})
