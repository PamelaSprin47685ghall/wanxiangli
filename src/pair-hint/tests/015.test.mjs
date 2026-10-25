import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const user = (key, time) => ({ kind: 'user', operator: true, key, timestamp: time, parts: [] })
const call = (id, tool) => ({ kind: 'assistant', operator: false, parts: [{ id, tool, terminalField: 'output' }] })
const result = id => ({ kind: 'result', operator: false, resultFor: id, resultField: 'content', parts: [] })

test('SPEC[pair-hint-015] a cold actor with previous reset strongly demands a fresh budget rather than inventing remaining 0', () => {
  const owner = PairHint()
  const sid = 'cold-budget-unknown-015'
  const historical = [user('first', 1), call('reset-1', 'resetScope'), result('reset-1'), user('later', 2),
    call('read-1', 'read'), result('read-1')]
  const first = owner.planRequest(sid, historical, 'zh-CN')
  assert.equal(first.initialized, false, 'a historical reset without recovered budget is not a usable scope')
  assert.equal(first.budgetKnown, false, 'historical reset does not contain a trustworthy current budget')
  assert.match(first.strong, /先调用 resetScope/, 'missing budget demands a fresh resetScope on every real request')
  assert.equal(first.weak, null, 'unknown budget is not exhausted budget')
  assert.deepEqual(first.hints, [], 'do not fabricate [Remaining turnBudget: 0] on old tool results')
  owner.startTurn(sid)
  const second = owner.planRequest(sid, [...historical, user('new operator instruction', 3)], 'zh-CN')
  assert.equal(second.budgetKnown, false)
  assert.match(second.strong, /先调用 resetScope/, 'the reminder repeats until an actual budget is established')
  assert.equal(second.weak, null)
  assert.deepEqual(second.hints, [])
  owner.clearSession(sid)
})

test('SPEC[pair-hint-015] a real committed budget observation restores normal countdown and genuine zero-budget weak hint', () => {
  const owner = PairHint()
  const sid = 'known-budget-015'
  const first = [user('first', 1), call('old-reset', 'resetScope'), result('old-reset')]
  owner.planRequest(sid, first, 'en')
  owner.resetSession(sid, 2)
  const observed = owner.planRequest(sid, [...first, call('read', 'read'), result('read')], 'en')
  assert.equal(observed.budgetKnown, true)
  assert.equal(observed.strong, null)
  assert.equal(observed.weak, null)
  assert.equal(observed.hints.find(h => h.index === 4)?.tail, '[Remaining turnBudget: 2]')
  owner.startTurn(sid)
  owner.startTurn(sid)
  const ended = owner.planRequest(sid, [...first, user('another task', 2)], 'en')
  assert.equal(ended.budgetKnown, true)
  assert.match(ended.weak, /Remaining 0|budget|turnBudget/i)
  assert.equal(ended.strong, null, 'exhausted budget only merits weak advice after real observation')
  owner.clearSession(sid)
})
