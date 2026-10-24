import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const hint = PairHint()
const SEP = '\0\uFEFF'
const user = (text, created = 1) => ({ info: { role: 'user', time: { created }, sessionID: 'ses_1' }, parts: [{ type: 'text', text }] })
const assistant = (...parts) => ({ info: { role: 'assistant', time: { created: 2 }, sessionID: 'ses_1' }, parts })
const tool = (callID, name, output, status = 'completed') => ({ type: 'tool', callID, tool: name, state: { status, output } })

test('SPEC[pair-hint-002] OpenCode user hints appear inside parts, never as top-level content', () => {
  const source = [user('do the task')]
  const transformed = hint.initializeUserMessages(source)
  assert.equal(transformed[0].content, undefined)
  assert.equal(transformed[0].info.role, 'user')
  assert.match(transformed[0].parts[0].text, /Then call resetScope immediately/)
  assert.equal(source[0].parts[0].text, 'do the task')
  assert.equal(hint.initializeUserMessages(transformed), transformed)
})

test('SPEC[pair-hint-002] OpenCode completed tools use state.output and retain message envelopes', () => {
  const raw = [user('task'), assistant(tool('read-1', 'read', 'source'), tool('reset-1', 'resetScope', 'Scope reset.'))]
  const changed = hint.injectToolResults(raw, false, 7)
  assert.ok(changed[1].parts[0].state.output.includes('Then call resetScope immediately'))
  assert.equal(changed[1].parts[1].state.output, 'Scope reset.' + SEP + '[Remaining turnBudget: 7]')
  assert.equal(changed[1].content, undefined)
  assert.equal(raw[1].parts[0].state.output, 'source')
  assert.equal(hint.injectToolResults(changed, false, 7), changed)
})

test('SPEC[pair-hint-002] tool errors get a suffix without converting the part to a text block', () => {
  const initial = [assistant({ type: 'tool', callID: 'fail', tool: 'read', state: { status: 'error', error: 'bad call' } })]
  const changed = hint.injectToolResults(initial, true, 0)
  assert.equal(changed[0].parts[0].state.error, 'bad call' + SEP + '[Remaining turnBudget: 0]')
  assert.equal(changed[0].parts[0].state.output, undefined)
  assert.equal(initial[0].parts[0].state.error, 'bad call')
})

test('SPEC[pair-hint-002] pending tool calls have no tool result, and are left untouched', () => {
  const messages = [assistant({ type: 'tool', callID: 'pending', tool: 'read', state: { status: 'running', input: {} } })]
  assert.equal(hint.injectToolResults(messages, true, 1), messages)
})

test('SPEC[pair-hint-002] the last OpenCode reset part controls the barrier; earlier tool state is discarded', () => {
  const messages = [user('task'), assistant(tool('a','read','old'), tool('b','resetScope','reset'), tool('c','read','new'))]
  const filtered = hint.filter(messages)
  assert.equal(filtered[1].content, undefined)
  assert.deepEqual(filtered[1].parts.map(p => p.callID), ['b','c'])
  assert.equal(messages[1].parts.length, 3)
  assert.equal(filtered[1].responseId, undefined)
})

test('SPEC[pair-hint-002] a new OpenCode steer appears after the last reset and invalidates its initial scope', () => {
  const messages = [user('first'), assistant(tool('r1', 'resetScope', 'done')), user('new', 9)]
  assert.equal(hint.hasResetSinceLastPrompt(messages), false)
  assert.equal(hint.lastPromptIndex(messages), 2)
  assert.notEqual(hint.promptKey(messages[0]), hint.promptKey(messages[2]))
})
