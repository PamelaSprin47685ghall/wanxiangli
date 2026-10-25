import assert from 'node:assert/strict'
import test from 'node:test'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const user = (key, time) => ({ kind: 'user', operator: true, key, timestamp: time, parts: [] })
const assistant = (id, tool, terminalField = 'output') => ({
  kind: 'assistant', operator: false, parts: [{ id, tool, terminalField }],
})
const result = id => ({ kind: 'result', operator: false, resultFor: id, resultField: 'content', parts: [] })
const suffix = (plan, index) => plan.hints.find(t => t.kind === 'tool' && t.index === index)?.tail

test('SPEC[pair-hint-007] a completed tool result is byte-identical in successive requests of the same epoch', () => {
  const hints = PairHint(), sid = 'prefix-stable-opencode'
  const prompt = user('100:task', 100)
  const reset = assistant('reset-1', 'resetScope')
  const read = assistant('read-1', 'read')
  hints.planRequest(sid, [prompt])
  hints.resetSession(sid, 6)
  const previous = hints.planRequest(sid, [prompt, reset])
  assert.equal(suffix(previous, 1), '[Remaining turnBudget: 6]')
  hints.startTurn(sid)
  const current = hints.planRequest(sid, [prompt, reset, read])
  assert.equal(current.budget, 5)
  assert.equal(suffix(current, 1), suffix(previous, 1), 'previous provider prefix must stay byte-identical')
  assert.equal(suffix(current, 2), '[Remaining turnBudget: 5]', 'new work should reveal the current budget')
  hints.clearSession(sid)
})

test('SPEC[pair-hint-007] old OMP result suffixes remain pinned after later turns and operator steer', () => {
  const hints = PairHint(), sid = 'prefix-stable-omp'
  const prompt = user('100:task', 100)
  const reset = assistant('r', 'resetScope', '')
  const output = result('r')
  hints.planRequest(sid, [prompt])
  hints.resetSession(sid, 4)
  const before = hints.planRequest(sid, [prompt, reset, output])
  assert.equal(suffix(before, 2), '[Remaining turnBudget: 4]')
  hints.startTurn(sid)
  const after = hints.planRequest(sid, [prompt, reset, output, user('200:change', 200)])
  assert.equal(after.budget, 3)
  assert.equal(after.initialized, true)
  assert.equal(after.strong, null)
  assert.equal(suffix(after, 2), suffix(before, 2), 'a new prompt cannot retroactively replace historical wire bytes')
  hints.clearSession(sid)
})

test('SPEC[pair-hint-007] new reset creates a cold epoch and lets previously retained reset pairs be rebuilt', () => {
  const hints = PairHint(), sid = 'prefix-reanchor'
  const prompt = user('100:task', 100), first = assistant('r1', 'resetScope')
  hints.planRequest(sid, [prompt])
  hints.resetSession(sid, 5)
  const before = hints.planRequest(sid, [prompt, first])
  hints.startTurn(sid)
  hints.resetSession(sid, 8)
  const after = hints.planRequest(sid, [prompt, first, assistant('r2', 'resetScope')])
  assert.equal(suffix(before, 1), '[Remaining turnBudget: 5]')
  assert.equal(suffix(after, 1), '[Remaining turnBudget: 8]', 'a committed scope reset is an explicit cold prefix boundary')
  hints.clearSession(sid)
})


test('SPEC[pair-hint-007] side-request previews do not freeze unseen results using a stale budget', () => {
  const hints = PairHint(), sid = 'prefix-side-preview'
  const prompt = user('100:task', 100)
  const reset = assistant('reset-1', 'resetScope')
  const read = assistant('read-1', 'read')
  hints.planRequest(sid, [prompt])
  hints.resetSession(sid, 6)
  const side = { kind: 'user', operator: false, sideRequest: true, parts: [] }
  const preview = hints.planRequest(sid, [prompt, reset, read, side])
  assert.equal(suffix(preview, 2), '[Remaining turnBudget: 6]')
  hints.startTurn(sid)
  const actual = hints.planRequest(sid, [prompt, reset, read])
  assert.equal(suffix(actual, 2), '[Remaining turnBudget: 5]', 'a side preview cannot pin a future ordinary result')
  assert.equal(suffix(hints.planRequest(sid, [prompt, reset, read]), 2), suffix(actual, 2))
  hints.clearSession(sid)
})
