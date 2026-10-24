import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const hint = PairHint()
const user = (text, timestamp) => ({ role: 'user', content: text, timestamp })
const reset = (id = 'reset') => ({ role: 'assistant', content: [{ type: 'toolCall', id, name: 'resetScope' }] })

test('SPEC[pair-hint-004] a new operator prompt invalidates the previous budget until resetScope', () => {
  const session = 'ses_budget_new'
  hint.prepareRequest(session, [user('first', 10)], false)
  hint.resetSession(session, 8)
  hint.prepareRequest(session, [user('first', 10), reset()], false)
  assert.equal(hint.isInitialized(session), true)
  assert.equal(hint.turnBudget(session), 8)
  hint.prepareRequest(session, [user('first', 10), reset(), user('second', 11)], false)
  assert.equal(hint.isInitialized(session), false)
  assert.equal(hint.turnBudget(session), 0)
  assert.equal(hint.toolResultFor(session, 'read', 'done').includes('Remaining turnBudget'), false)
  hint.resetSession(session, 4)
  assert.equal(hint.turnBudget(session), 4)
  assert.equal(hint.toolResultFor(session, 'read', 'done').endsWith('[Remaining turnBudget: 4]'), true)
  hint.clearSession(session)
  assert.equal(hint.isInitialized(session), false)
})

test('SPEC[pair-hint-004] side requests do not change the active prompt budget, older snapshots do not reverse initialization', () => {
  const session = 'ses_side'
  const first = user('first', 1)
  const second = user('second', 9)
  hint.prepareRequest(session, [first, second], false)
  hint.resetSession(session, 6)
  hint.startTurn(session)
  assert.equal(hint.turnBudget(session), 5)
  const side = { ...user('title', 100), attribution: 'agent' }
  hint.prepareRequest(session, [first, second, side], false)
  assert.equal(hint.turnBudget(session), 5)
  hint.prepareRequest(session, [first], false)
  assert.equal(hint.isInitialized(session), true)
  assert.equal(hint.turnBudget(session), 5)
  hint.clearSession(session)
})

test('SPEC[pair-hint-004] a zero budget adds a weak steer without interrupting the current scope', () => {
  const session = 'ses_zero'
  const initial = user('task', 1)
  hint.prepareRequest(session, [initial], false)
  hint.resetSession(session, 1)
  hint.startTurn(session)
  const prepared = hint.prepareRequest(session, [initial, reset()], false)
  const reminder = prepared.at(-1)
  assert.equal(reminder.attribution, 'agent')
  assert.equal(reminder.steering, true)
  assert.match(reminder.content[0].text, /Do not interrupt, pause, or abandon/)
  assert.equal(hint.turnBudget(session), 0)
  hint.clearSession(session)
})
