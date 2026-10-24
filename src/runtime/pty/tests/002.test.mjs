import test from 'node:test'
import assert from 'node:assert/strict'
import { bunMissing, scenario } from './support.mjs'

test('SPEC[pty-002] a real terminal is a tty; write then read returns the echo and program output; UTF-8 intact', { skip: bunMissing }, () => {
  const r = scenario('roundtrip')
  assert.deepEqual(r.first, { kind: 'Read', output: 'tty-yes\r\n', closed: false })
  assert.deepEqual(r.write, { kind: 'Written' })
  assert.equal(r.rest.closed, true)
  assert.match(r.rest.output, /got:abc\r\n/)
  assert.match(r.rest.output, /中文✓/)
  assert.deepEqual(r.exit, { exitCode: 0, signal: null })
  assert.equal(r.inspect.phase, 'Exited')
  assert.deepEqual(r.after, {
    write: { kind: 'Closed' }, signal: { kind: 'Closed' }, resize: { kind: 'Closed' },
    read: { kind: 'Read', output: '', closed: true },
  })
})

test('SPEC[pty-002] a silent terminal answers "" after the wait; a second concurrent read is Busy', { skip: bunMissing }, () => {
  const r = scenario('silent')
  assert.deepEqual(r.busy, { kind: 'Busy' })
  assert.deepEqual(r.read, { kind: 'Read', output: '', closed: false })
  assert.ok(r.elapsed >= 280 && r.elapsed < 2000, `elapsed ${r.elapsed}`)
  assert.deepEqual(r.immediate, { kind: 'Read', output: '', closed: false })
  assert.equal(r.closed.kind, 'Exited')
})

test('SPEC[pty-002] a parked read is answered by the first byte, not by the timer', { skip: bunMissing }, () => {
  const r = scenario('wake')
  assert.deepEqual(r.read, { kind: 'Read', output: 'late\r\n', closed: false })
  assert.ok(r.elapsed < 5000, `elapsed ${r.elapsed}`)
})

test('SPEC[pty-002] resize reaches the terminal', { skip: bunMissing }, () => {
  const r = scenario('resize')
  assert.deepEqual(r.resized, { kind: 'Resized' })
  assert.equal(r.rest.output, '40 120\r\n')
})

test('SPEC[pty-002] a missing cwd fails instead of running the command elsewhere', { skip: bunMissing }, () => {
  const r = scenario('badCwd')
  assert.equal(r.opened.kind, 'Failed')
  assert.equal(r.opened.error.code, 'ENOENT')
})
