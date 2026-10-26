import assert from 'node:assert/strict'
import test from 'node:test'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const scope = PairHint()
const user = (key, time) => ({ kind: 'user', operator: true, key, timestamp: time, parts: [] })
const part = (id, tool, terminalField) => ({ id, tool, ...(terminalField ? { terminalField } : {}) })
const assistant = (...parts) => ({ kind: 'assistant', operator: false, parts })
const result = (id) => ({ kind: 'result', operator: false, parts: [], resultFor: id, resultField: 'content' })

test('SPEC[pair-hint-006] the neutral plan cuts an assistant batch at the latest reset and preserves paired results', () => {
  const session = 'neutral-reset-batch'
  const messages = [
    user('start', 1), assistant(part('old', 'read')), result('old'),
    assistant(part('reset-a', 'resetScope')), result('reset-a'),
    user('steer', 2), assistant(part('before', 'write'), part('reset-b', 'resetScope'), part('after', 'read')),
    result('before'), result('reset-b'), result('after'),
  ]
  const raw = structuredClone(messages)
  const plan = scope.planRequest(session, messages)
  assert.deepEqual(plan.slots.map(s => s.index), [0, 3, 4, 5, 6, 8, 9])
  assert.deepEqual(plan.slots[4].parts, [1, 2])
  assert.equal(plan.budgetKnown,false)
  assert.equal(plan.strong,null,'initial budget estimation belongs to ScopeProgress, not PairHint')
  assert.deepEqual(plan.hints,[],'no fabricated budget after cold history')
  assert.deepEqual(messages, raw, 'the planner does not edit the host projection')
  scope.clearSession(session)
})

test('SPEC[pair-hint-006] PairHint keeps user prompts and tools unchanged without owning progress estimation', () => {
  const session = 'neutral-budget'
  scope.planRequest(session, [user('1:begin', 1)])
  scope.resetSession(session, 7)
  let plan = scope.planRequest(session, [user('1:begin', 1), assistant(part('reset', 'resetScope', 'output'))])
  assert.equal(plan.initialized, true)
  assert.equal(plan.budget, 7)
  assert.deepEqual(plan.hints,[],'the old tool-result budget countdown is retired')
  scope.startTurn(session)
  plan = scope.planRequest(session, [user('1:begin', 1), assistant(part('reset', 'resetScope', 'output'))])
  assert.equal(plan.weak, null)
  plan = scope.planRequest(session, [user('1:begin', 1), assistant(part('reset', 'resetScope', 'output')), user('2:new', 2)])
  assert.equal(plan.weak, null)
  assert.equal(plan.initialized, true)
  assert.equal(plan.strong, null)
  assert.equal(plan.hints.some(h => h.kind === 'user' && h.index === 2), false)
  scope.clearSession(session)
})

test('SPEC[pair-hint-006] a neutral side request cannot change the prompt boundary or synthesize progress notices', () => {
  const session = 'neutral-side'
  scope.planRequest(session, [user('1:task', 1)])
  scope.resetSession(session, 5)
  const side = { kind: 'user', operator: false, sideRequest: true, key: 'side', timestamp: 99, parts: [] }
  const plan = scope.planRequest(session, [user('1:task', 1), side])
  assert.equal(plan.initialized, true)
  assert.equal(plan.strong, null)
  assert.equal(plan.weak, null)
  assert.equal(plan.slots.length, 2)
  assert.equal(scope.appendTailOnce('done', '[Remaining turnBudget: 5]'), 'done\0\uFEFF[Remaining turnBudget: 5]')
  assert.equal(scope.appendTailOnce('done\0\uFEFF[Remaining turnBudget: 5]', '[Remaining turnBudget: 5]'), 'done\0\uFEFF[Remaining turnBudget: 5]')
  scope.clearSession(session)
})

test('SPEC[pair-hint-006] a neutral request without an operator prompt is preserved byte-for-byte', () => {
  const session = 'neutral-no-prompt'
  const plan = scope.planRequest(session, [assistant(part('old', 'read')), result('old')])
  assert.equal(plan.active, false)
  assert.deepEqual(plan.slots.map(x => x.index), [0, 1])
  assert.equal(plan.hints.length, 0)
  assert.equal(plan.weak, null)
  scope.clearSession(session)
})


test('SPEC[pair-hint-006] co-located snapshot results follow their historical reset call', () => {
  const entries = [
    user('initial', 1),
    assistant({ id: 'old', tool: 'read' }, { resultFor: 'old' }, { id: 'r1', tool: 'resetScope' }, { resultFor: 'r1' }),
    assistant({ id: 'next', tool: 'read' }, { resultFor: 'next' }, { id: 'r2', tool: 'resetScope' }, { resultFor: 'r2' }),
  ]
  const slots = scope.planFilter(entries)
  assert.deepEqual(slots.map(x => x.index), [0, 1, 2])
  assert.deepEqual(Array.from(slots[1].parts), [2, 3])
  assert.deepEqual(Array.from(slots[2].parts), [2, 3])
})
