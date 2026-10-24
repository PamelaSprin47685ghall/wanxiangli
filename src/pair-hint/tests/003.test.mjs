import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const hint = PairHint()
const SEP = '\0\uFEFF'
const reset = 'resetScope'

test('SPEC[pair-hint-003] user-message injection is independent of tool-result injection', () => {
  const user = { role: 'user', content: [{ type: 'text', text: 'hello' }] }
  const tool = { role: 'toolResult', toolCallId: 'read', toolName: 'read', content: [{ type: 'text', text: 'output' }] }
  const userLine = hint.initializeUserMessages([user, tool])
  assert.equal(userLine[1], tool)
  assert.equal(userLine[0].content[0].text, 'hello' + hint.appendUserReminder(''))
  const toolLine = hint.injectToolResults([user, tool], true, 3)
  assert.equal(toolLine[0], user)
  assert.equal(toolLine[1].content[0].text, 'output' + SEP + '[Remaining turnBudget: 3]')
})

test('SPEC[pair-hint-003] non-reset tools never mix initialization and budget suffixes', () => {
  const init = hint.injectToolResultContent('raw', 'read', false, 0)
  const budget = hint.injectToolResultContent('raw', 'read', true, 2)
  const resetResult = hint.injectToolResultContent('Scope reset', reset, false, 5)
  assert.match(init, /Then call resetScope immediately/)
  assert.equal(init.includes('Remaining turnBudget'), false)
  assert.equal(budget, 'raw' + SEP + '[Remaining turnBudget: 2]')
  assert.equal(resetResult, 'Scope reset' + SEP + '[Remaining turnBudget: 5]')
  assert.equal(hint.injectToolResultContent(budget, 'read', true, 1), budget)
})

test('SPEC[pair-hint-003] old contradictory budget tails are removed without changing other content', () => {
  const reminder = hint.appendUserReminder('')
  const message = { role: 'toolResult', content: 'output' + SEP + '[Remaining turnBudget: 0]' + SEP + reminder.slice(SEP.length) }
  const next = hint.stripContradictions([message])
  assert.equal(next[0].content, 'output' + SEP + reminder.slice(SEP.length))
  assert.equal(message.content.includes('[Remaining turnBudget: 0]'), true)
})
