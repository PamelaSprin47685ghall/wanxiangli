import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const hint = PairHint()
const SEP = '\0\uFEFF'
const user = (text) => ({ info: { role: 'user', id: 'u1' }, parts: [{ type: 'text', text }] })
const toolMessage = (state) => ({ info: { role: 'assistant', id: 'a1' }, parts: [{ type: 'tool', tool: 'read', callID: 'c1', state }] })

test('SPEC[pair-hint-005] the user-message physical line writes only to the last text part, once', () => {
  const original = user('operator message')
  const rendered = '<system>\nFollow the task.\n</system>'
  const first = hint.writeUserHint(original, [rendered])
  assert.equal(first.info, original.info)
  assert.equal(first.content, undefined)
  assert.equal(first.parts[0].text, 'operator message' + SEP + rendered)
  assert.equal(original.parts[0].text, 'operator message')
  assert.equal(hint.writeUserHint(first, [rendered]), first)
  assert.equal(hint.stripKnownHints(first, [rendered]).parts[0].text, 'operator message')
  assert.equal(hint.userCanCarryHint(first), true)
})

test('SPEC[pair-hint-005] the tool-result physical line writes completed output and error separately from user messages', () => {
  const completed = toolMessage({ status: 'completed', output: 'stdout' })
  const errored = toolMessage({ status: 'error', error: 'failure' })
  const pending = toolMessage({ status: 'running' })
  const result = hint.writeToolResultHint(completed, ['marker'])
  const failed = hint.writeToolResultHint(errored, ['marker'])
  assert.equal(result.parts[0].state.output, 'stdout' + SEP + 'marker')
  assert.equal(failed.parts[0].state.error, 'failure' + SEP + 'marker')
  assert.equal(result.content, undefined)
  assert.equal(completed.parts[0].state.output, 'stdout')
  assert.equal(hint.writeToolResultHint(result, ['marker']), result)
  assert.equal(hint.stripKnownHints(result, ['marker']).parts[0].state.output, 'stdout')
  assert.equal(hint.stripKnownHints(failed, ['marker']).parts[0].state.error, 'failure')
  assert.equal(hint.writeToolResultHint(pending, ['marker']), pending)
  assert.equal(hint.toolCanCarryHint(completed), true)
  assert.equal(hint.toolCanCarryHint(pending), false)
})

test('SPEC[pair-hint-005] a provider envelope is never rewritten in place for user or result hints', () => {
  const message = user('hello')
  const another = hint.writeUserHint(message, ['A', 'B'])
  assert.equal(another.parts[0].text, 'hello' + SEP + 'A' + SEP + 'B')
  assert.equal(message.parts[0].text, 'hello')
  assert.equal(hint.stripKnownHints(another, ['A', 'B']).parts[0].text, 'hello')
})
