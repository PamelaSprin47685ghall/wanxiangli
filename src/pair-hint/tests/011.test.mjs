import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const owner = PairHint()
const user = key => ({ kind: 'user', operator: true, key, timestamp: 1, parts: [] })
const call = (id, tool) => ({ id, tool })
const assistant = (...parts) => ({ kind: 'assistant', operator: false, parts })
const result = id => ({ kind: 'result', operator: false, resultFor: id, resultField: 'content', parts: [] })
const ids = slots => slots.map(s => s.index)

test('SPEC[pair-hint-011] assume, negotiate, askPreviousScope and advisor calls and results survive every later reset', () => {
  const names = ['assume', 'negotiate', 'askPreviousScope', 'advisor']
  const history = [user('goal')]
  for (const [i, name] of names.entries()) {
    history.push(assistant(call('must-' + i, name)), result('must-' + i))
    history.push(assistant(call('noise-' + i, 'read')), result('noise-' + i))
  }
  history.push(assistant(call('r1', 'resetScope')), result('r1'))
  history.push(assistant(call('new', 'edit')), result('new'))
  history.push(assistant(call('r2', 'resetScope')), result('r2'))
  const kept = owner.planFilter(history)
  for (const [i, name] of names.entries()) {
    const ci = 1 + i * 4
    assert.ok(ids(kept).includes(ci), name + ' call must survive')
    assert.ok(ids(kept).includes(ci + 1), name + ' exact result must survive')
    assert.ok(!ids(kept).includes(ci + 2), 'ordinary call dropped')
    assert.ok(!ids(kept).includes(ci + 3), 'ordinary result dropped')
  }
  assert.ok(ids(kept).includes(history.length - 1), 'latest reset result retained')
})

test('SPEC[pair-hint-011] mixed same-assistant call/result parts keep the exact pair, but not adjacent ordinary parts', () => {
  const mixed = [
    { id: 'old', tool: 'bash' },
    { id: 'persisted', tool: 'assume' },
    { resultFor: 'old' },
    { resultFor: 'persisted' },
    { id: 'reset', tool: 'resetScope' },
    { resultFor: 'reset' },
    { id: 'new', tool: 'edit' },
    { resultFor: 'new' },
  ]
  const messages = [user('goal'), assistant(...mixed), result('old'), result('persisted'), result('reset')]
  const selected = owner.planFilter(messages)
  assert.deepEqual(Array.from(selected[1].parts), [1, 3, 4, 5, 6, 7])
  assert.ok(!ids(selected).includes(2), 'cross-message ordinary result is removed')
  assert.ok(ids(selected).includes(3), 'retained cross-message output is preserved')
  assert.ok(ids(selected).includes(4), 'reset result is preserved')
  assert.deepEqual(messages[1].parts, mixed, 'input physical parts are never mutated')
})

test('SPEC[pair-hint-011] legacy askPrevious spelling remains retained and a forged unrelated result is not', () => {
  const messages = [user('goal'), assistant(call('old', 'askPrevious')), result('old'), result('forged'),
    assistant(call('reset', 'resetScope')), result('reset')]
  assert.deepEqual(ids(owner.planFilter(messages)), [0, 1, 2, 4, 5])
})

test('SPEC[pair-hint-011] several reset cycles cannot expel retained original input or output', () => {
  const messages = [user('first'), assistant(call('a', 'advisor')), result('a')]
  for (let i = 0; i < 5; i++) {
    messages.push(assistant(call('r' + i, 'resetScope')), result('r' + i),
      assistant(call('noise' + i, 'write')), result('noise' + i))
  }
  const selected = owner.planFilter(messages)
  assert.ok(ids(selected).includes(1), 'advisor original input still exists')
  assert.ok(ids(selected).includes(2), 'advisor original output still exists')
  assert.ok(ids(selected).includes(messages.length - 1), 'current scope work still survives after the latest reset')
  assert.ok(!ids(selected).includes(5), 'noise from earlier scope was purged')
})
