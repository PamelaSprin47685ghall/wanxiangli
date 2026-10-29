import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const owner = PairHint()
const user = (key) => ({ kind: 'user', operator: true, key, timestamp: 1, parts: [] })
const assistant = (...parts) => ({ kind: 'assistant', operator: false, parts })
const result = (id) => ({ kind: 'result', operator: false, parts: [], resultFor: id, resultField: 'content' })
const call = (id, tool, scope) => ({
  id,
  tool,
  ...(scope ? { scope } : {}),
})
const resetAnno = {
  kind: 'resetScope',
  newScopeGoal: 'land annotation barrier',
  newScopeRetentionBudget: 4,
  oldScopeVerboseVerbatim: '',
}

test('SPEC[pair-hint-018] scope.kind=resetScope on any tool is a reset barrier (legacy tool name still works)', () => {
  // Old ordinary work, then a read with resetScope annotation — barrier must cut prior process.
  const raw = [
    user('start'),
    assistant(call('old', 'write')),
    result('old'),
    assistant(call('r1', 'read', resetAnno)),
    result('r1'),
    assistant(call('new', 'read')),
    result('new'),
  ]
  const slots = owner.planFilter(raw)
  assert.deepEqual(
    slots.map((s) => s.index),
    [0, 3, 4, 5, 6],
    'annotation reset drops prior ordinary tool process; keeps user + reset pair + after'
  )
})

test('SPEC[pair-hint-018] annotated reset call and its result are always retained across a later reset', () => {
  const raw = [
    user('start'),
    assistant(call('r1', 'todowrite-for-manager', resetAnno)),
    result('r1'),
    assistant(call('work', 'read')),
    result('work'),
    assistant(call('r2', 'bash', resetAnno)),
    result('r2'),
  ]
  const slots = owner.planFilter(raw)
  assert.deepEqual(
    slots.map((s) => s.index),
    [0, 1, 2, 5, 6],
    'older annotated reset pair stays; ordinary work before latest reset is cut'
  )
})

test('SPEC[pair-hint-018] nested arguments.scope.kind also counts (wire / host shape)', () => {
  const raw = [
    user('start'),
    assistant(call('old', 'read')),
    result('old'),
    assistant({
      id: 'r',
      tool: 'fetch',
      arguments: { scope: resetAnno, url: 'https://example.com' },
    }),
    result('r'),
  ]
  const slots = owner.planFilter(raw)
  assert.deepEqual(slots.map((s) => s.index), [0, 3, 4])
})

test('SPEC[pair-hint-018] state.input.scope.kind (OpenCode tool part shape) counts on wire barrier', () => {
  // precedingScopeMessages / isResetWirePart path behind latestPrevious
  const session = 'wire-018'
  const before = { info: { sessionID: session, role: 'user' }, parts: [{ type: 'text', text: 'old' }] }
  const reset = {
    info: { role: 'assistant' },
    parts: [
      {
        type: 'tool',
        id: 'r',
        tool: 'read',
        state: { input: { scope: resetAnno, path: 'x' }, status: 'completed', output: 'ok' },
      },
    ],
  }
  const after = { role: 'user', content: 'SECRET_NEW' }
  owner.rememberTransform(session, [before, reset, after], [{ role: 'user', content: 'summarized' }])
  const messages = owner.latestPrevious(session)
  assert.equal(JSON.stringify(messages).includes('SECRET_NEW'), false, 'new-scope content stays out')
  assert.equal(messages.length >= 1, true)
  owner.clearSession(session)
})

test('SPEC[pair-hint-018] legacy tool name resetScope still barriers without annotation', () => {
  const raw = [
    user('start'),
    assistant(call('old', 'read')),
    result('old'),
    assistant(call('r', 'resetScope')),
    result('r'),
  ]
  const slots = owner.planFilter(raw)
  assert.deepEqual(slots.map((s) => s.index), [0, 3, 4])
})
