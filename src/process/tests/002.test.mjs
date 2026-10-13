import test from 'node:test'
import assert from 'node:assert/strict'
import { session, ready, closed, until, output } from './support.mjs'

test('SPEC[process-002] real stdin preserves binary bytes and EOF is idempotent', async t => {
  const run = session(t, 'echo')
  await ready(run)
  const bytes = Buffer.from([0, 65, 255, 13, 10, 0xf0, 0x9f, 0x98, 0x80])
  assert.deepEqual(await run.write(bytes), { kind: 'Written', bytes: bytes.length })
  run.endInput()
  run.endInput()
  await closed(run)
  assert.deepEqual(Buffer.from(output(run).bytes), bytes)
  assert.throws(() => run.write(Buffer.from('late')), /not open/)
})

test('SPEC[process-002] pending writes own a copy and do not alias caller bytes', async t => {
  const run = session(t, 'echo', [], { tailBytes: 1048576 })
  await ready(run)
  const bytes = new Uint8Array(400000).fill(65)
  const result = run.write(bytes)
  bytes.fill(66)
  assert.equal((await result).kind, 'Written')
  run.endInput()
  await closed(run)
  assert.deepEqual(output(run).bytes, new Uint8Array(400000).fill(65))
})

test('SPEC[process-002] excess input and overlapping writes cannot form an unbounded queue', async t => {
  const run = session(t, 'paused', [], { maxWriteBytes: 2097152 })
  await ready(run)
  await until(() => output(run).text === 'ready\n')
  assert.throws(() => run.write(new Uint8Array(2097153)), /maxWriteBytes/)
  const pending = run.write(new Uint8Array(2097152))
  assert.throws(() => run.write(new Uint8Array([1])), /pending/)
  assert.equal(run.signal('SIGKILL').kind, 'Requested')
  const result = await pending
  assert.equal(result.kind, 'Unknown')
  await closed(run)
})

test('SPEC[process-002] a broken input pipe is unknown consumption, not automatic retry', async t => {
  const run = session(t, 'broken-input')
  await ready(run)
  await until(() => output(run).text === 'ready\n')
  const result = await run.write(new Uint8Array(65536).fill(65))
  assert.equal(result.kind, 'Unknown')
  assert.equal(run.inspect().stdin, 'Failed')
  result.error.message = 'mutated by caller'
  assert.notEqual(run.inspect().failure.message, 'mutated by caller')
  assert.throws(() => run.write(new Uint8Array([1])), /not open/)
})

test('SPEC[process-002] non-byte and shared inputs are rejected without writing', async t => {
  const run = session(t, 'echo')
  await ready(run)
  for (const bytes of ['text', [1, 2], new Uint16Array(2), new Uint8Array(new SharedArrayBuffer(4))]) {
    assert.throws(() => run.write(bytes), /Uint8Array/)
  }
  run.endInput()
  await closed(run)
  assert.equal(output(run).to, 0)
})
