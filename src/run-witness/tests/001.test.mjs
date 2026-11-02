import test from 'node:test'
import assert from 'node:assert/strict'

import { ProviderRunWitness } from 'wanxiangli/run-witness'

const A = { model: 'a/x', reasoning: 'none' }
const B = { model: 'b/y', reasoning: 'high' }

test('SPEC[run-witness-1] one live witness per session, taken once, by reference', () => {
  const w = new ProviderRunWitness()
  w.remember('s1', 'r1', A)
  w.remember('s1', 'r2', B)
  assert.equal(w.take('r1'), null, 'the older run of the session was retired')
  const view = w.take('r2')
  assert.ok(Object.isFrozen(view))
  assert.equal(view.sessionId, 's1')
  assert.equal(view.target, B)
  assert.equal(w.take('r2'), null, 'single consumption')
  assert.deepEqual({ ...w.snapshot() }, { witnesses: 0, latest: 0, steps: 0,  })
})

test('SPEC[run-witness-1] taking an old run does not forget a newer latest run of the same session', () => {
  const w = new ProviderRunWitness()
  w.remember('s1', 'r1', A)
  w.remember('s2', 'r9', B)
  assert.equal(w.take('r9').target, B)
  assert.equal(w.take('r1').target, A)
  w.remember('s1', 'r3', A)
  w.remember('s1', 'r3', B)
  assert.equal(w.take('r3').target, B, 'the same run re-remembered keeps the latest target')
})

test('SPEC[run-witness-3] run → physical relation only from explicit records', () => {
  const w = new ProviderRunWitness()
  assert.equal(w.stepOf('r1'), null)
  w.rememberStep('s1', 'p1', 'r1')
  assert.deepEqual({ ...w.stepOf('r1') }, { sessionId: 's1', physicalUserMessageId: 'p1' })
  w.rememberStep('s1', 'p2', 'r1')
  assert.equal(w.stepOf('r1').physicalUserMessageId, 'p2')
})

test('SPEC[run-witness-4] forgetSession and forgetPhysical drop exactly their scope', () => {
  const w = new ProviderRunWitness()
  w.remember('s1', 'r1', A)
  w.remember('s2', 'r2', B)
  w.rememberStep('s1', 'p1', 'r1')
  w.rememberStep('s1', 'p2', 'r3')
  w.rememberStep('s2', 'p1', 'r2')
  w.remember('s1', 'rx', A)
  w.remember('s1', 'r1', A)
  w.forgetPhysical('s1', 'p1')
  assert.equal(w.stepOf('r1'), null)
  assert.ok(w.stepOf('r3'))
  assert.ok(w.stepOf('r2'), 'same physical id of another session is kept')
  w.forgetSession('s1')
  assert.equal(w.stepOf('r3'), null)
  assert.equal(w.take('r1'), null)
  assert.equal(w.take('r2').target, B, 'other sessions untouched')
  assert.ok(w.stepOf('r2'))
})

test('SPEC[run-witness-0] malformed input is rejected', () => {
  const w = new ProviderRunWitness()
  assert.throws(() => w.remember('s1', 'r1', null), /requires a target/)
  assert.throws(() => w.remember(1, 'r1', A), /requires string sessionId/)
  assert.throws(() => w.take(undefined), /requires string providerRun/)
  assert.throws(() => w.rememberStep('s', null, 'r'), /physicalUserMessageId/)
})
