import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const hint = PairHint()
const call = (id, name) => ({ type: 'toolCall', id, name, arguments: {} })
const assistant = (...content) => ({ role: 'assistant', content })
const result = (id, value = 'result') => ({ role: 'toolResult', toolCallId: id, content: value })
const user = (value, timestamp = 1) => ({ role: 'user', content: value, timestamp })

test('SPEC[pair-hint-001] last reset removes prior work but keeps every user message and reset pair', () => {
  const source = [
    user('first'), assistant(call('r1', 'resetScope')), result('r1'),
    assistant(call('a', 'read')), result('a'), user('steer', 2),
    assistant(call('b', 'read')), result('b'),
    assistant(call('r2', 'resetScope')), result('r2'),
    assistant(call('c', 'read')), result('c'),
  ]
  const filtered = hint.filter(source)
  assert.deepEqual(filtered.map(x => x.toolCallId ?? (x.role === 'assistant' ? x.content[0].id : x.content)),
    ['first', 'r1', 'r1', 'steer', 'r2', 'r2', 'c', 'c'])
  assert.equal(source.length, 12)
  assert.equal(source[3].content[0].name, 'read')
})

test('SPEC[pair-hint-001] the tool barrier splits one assistant message by call position and result identity', () => {
  const message = { ...assistant({ type: 'text', text: 'old' }, call('before', 'read'), call('reset', 'resetScope'), call('after', 'read')), providerPayload: { stale: 1 }, responseId: 'response' }
  const filtered = hint.filter([user('task'), message, result('before'), result('reset'), result('after')])
  assert.deepEqual(filtered[1].content.map(x => x.id), ['reset', 'after'])
  assert.equal(filtered[1].providerPayload, undefined)
  assert.equal(filtered[1].responseId, undefined)
  assert.deepEqual(filtered.map(x => x.toolCallId).filter(Boolean), ['reset', 'after'])
  assert.equal(message.content.length, 4)
})

test('SPEC[pair-hint-001] the user steer is not a barrier or an agent-authored side request', () => {
  const steer = { ...user('change direction', 3), steering: true }
  const side = { ...user('title', 4), attribution: 'agent' }
  assert.equal(hint.isScopePrompt(steer), true)
  assert.equal(hint.isScopePrompt(side), false)
  assert.equal(hint.endsWithSideRequest([side]), true)
  assert.equal(hint.lastPromptIndex([user('old'), steer, side]), 1)
  assert.equal(hint.hasResetSinceLastPrompt([steer, assistant(call('reset', 'resetScope'))]), true)
})
