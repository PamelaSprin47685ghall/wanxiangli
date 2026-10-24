import test from 'node:test'
import assert from 'node:assert/strict'
import { bunMissing, scenario } from './support.mjs'

test('SPEC[pty-003] close reclaims the whole process group, including a descendant that ignores TERM', { skip: bunMissing }, () => {
  const r = scenario('descendants')
  assert.equal(r.before, true)
  assert.equal(r.closed.kind, 'Exited')
  assert.equal(r.after, false, `descendant ${r.child} survived close`)
  assert.equal(r.inspect.phase, 'Exited')
})

test('SPEC[pty-003] close escalates to KILL when TERM is ignored, and a second close reports AlreadyExited', { skip: bunMissing }, () => {
  const r = scenario('escalate')
  assert.equal(r.closed.kind, 'Exited')
  assert.equal(r.closed.escalated, true)
  assert.ok(r.elapsed >= 280, `elapsed ${r.elapsed}`)
  assert.equal(r.again.kind, 'AlreadyExited')
})

test('SPEC[pty-003] signal reaches the foreground program and wait resolves with the exit', { skip: bunMissing }, () => {
  const r = scenario('signal')
  assert.deepEqual(r.sent, { kind: 'Sent' })
  assert.notEqual(r.exit, 'timeout')
  assert.equal(typeof r.exit.exitCode, 'number')
  assert.equal(r.exit.signal, null)
})
