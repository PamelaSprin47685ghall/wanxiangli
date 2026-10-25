import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const user = (key, stamp = 1) => ({
  kind: 'user', operator: true, key, timestamp: stamp, parts: [],
})
const call = (id, tool) => ({
  kind: 'assistant', operator: false,
  parts: [{ id, tool, terminalField: 'output' }],
})
const result = id => ({
  kind: 'result', operator: false, resultFor: id, resultField: 'content', parts: [],
})
const tail = (plan, index) => plan.hints.find(item => item.kind === 'tool' && item.index === index)?.tail

test('SPEC[pair-hint-010] negotiate first answer and askPreviousScope first call have distinct admission witnesses', () => {
  const owner = PairHint()
  const delegated = 'child-negotiation-010'
  owner.bindDelegation(delegated, 'parent')
  assert.equal(owner.pendingKind(delegated), 'negotiate')
  const original = owner.askNegotiation(delegated, 'Clarify the task')
  assert.equal(original.ok, true)
  assert.equal(owner.pendingKind(delegated), 'negotiate',
    'merely asking does not count as receiving the parent reply')
  assert.equal(owner.prepareNegotiationReply(original.receipt, 'Parent answer').ok, true)
  assert.equal(owner.pendingKind(delegated), 'negotiate')
  assert.equal(owner.confirmNegotiationSteer(original.receipt, delegated), true)
  assert.equal(owner.pendingKind(delegated), 'none')

  const scope = 'child-scope-010'
  owner.resetSession(scope, 8)
  owner.beginAskPreviousScope(scope)
  assert.equal(owner.pendingKind(scope), 'askPreviousScope')
  assert.equal(owner.isInitialized(scope), false, 'initialization freezes during first ask')
  const first = owner.askPreviousScope(scope, 'Which part of the handoff is unresolved?', 'tool-call-1')
  assert.equal(first.ok, true)
  assert.equal(first.first, true)
  assert.equal(owner.pendingKind(scope), 'none', 'the valid first actual tool call unlocks immediately')
  assert.equal(owner.isInitialized(scope), true)
  assert.equal(owner.turnBudget(scope), 8)
  assert.equal(owner.askPreviousScope(scope, 'Another question?', 'tool-call-2').first, false)
  owner.clearSession(scope)
  owner.clearSession(delegated)
})

test('SPEC[pair-hint-010] both MUST pending states freeze turnBudget and repeat on first-seen ordinary tool results, never editing source bytes', () => {
  for (const kind of ['negotiate', 'askPreviousScope']) {
    const owner = PairHint()
    const session = 'pending-' + kind
    if (kind === 'negotiate') owner.bindDelegation(session, 'parent')
    else {
      owner.resetSession(session, 7)
      owner.beginAskPreviousScope(session)
    }
    const raw = [user('operator'), call('read-1', 'read'), result('read-1')]
    const before = JSON.stringify(raw)
    const plan = owner.planRequest(session, raw, 'en')
    assert.equal(plan.pendingKind, kind)
    assert.equal(plan.initialized, false)
    assert.equal(plan.weak, null)
    assert.match(plan.hints[0].tail, new RegExp(kind, 'i'))
    assert.match(tail(plan, 1), new RegExp(kind, 'i'))
    assert.match(tail(plan, 2), new RegExp(kind, 'i'))
    assert.doesNotMatch(tail(plan, 2), /Remaining turnBudget/)
    const currentBudget = owner.turnBudget(session)
    for (let n = 0; n < 5; n++) owner.startTurn(session)
    assert.equal(owner.turnBudget(session), currentBudget)
    const next = owner.planRequest(session, [...raw, call('write-2', 'write'), result('write-2')], 'en')
    assert.equal(tail(next, 1), tail(plan, 1), 'already rendered result suffix is frozen')
    assert.match(tail(next, 4), new RegExp(kind, 'i'))
    assert.equal(JSON.stringify(raw), before, 'neither raw user nor raw tool input is mutated')
    owner.clearSession(session)
  }
})

test('SPEC[pair-hint-010] normal budget suffix resumes on newly encountered results only after askPreviousScope first receipt', () => {
  const owner = PairHint()
  const session = 'pending-unlocked-010'
  const original = [user('operator'), call('reset-1', 'resetScope'), result('reset-1')]
  owner.resetSession(session, 6)
  owner.beginAskPreviousScope(session)
  const first = owner.planRequest(session, original, 'en')
  const originalTail = tail(first, 2)
  assert.match(originalTail, /askPreviousScope/)
  assert.doesNotMatch(originalTail, /Remaining turnBudget/)
  const accepted = owner.askPreviousScope(session, 'What caused the earlier exception?', 'call-unique-010')
  assert.equal(accepted.ok, true)
  owner.startTurn(session)
  const next = owner.planRequest(session, [...original, call('new', 'read'), result('new')], 'en')
  assert.equal(tail(next, 2), originalTail, 'old text remains byte-for-byte frozen in this epoch')
  assert.equal(tail(next, 4), '[Remaining turnBudget: 5]')
  assert.equal(owner.turnBudget(session), 5)
  owner.clearSession(session)
})
