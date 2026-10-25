import assert from 'node:assert/strict'
import test from 'node:test'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const user = (key, time = 1) => ({ kind: 'user', operator: true, key, timestamp: time, parts: [] })
const assistant = (id, name = 'read', terminalField = 'output') => ({
  kind: 'assistant', operator: false, parts: [{ id, tool: name, terminalField }],
})
const result = id => ({ kind: 'result', operator: false, resultFor: id, resultField: 'content', parts: [] })
const tail = (plan, kind) => plan.hints.find(h => h.kind === kind)?.tail

test('SPEC[pair-hint-009] actual state-owned reminders honor the explicitly supplied provider language', () => {
  for (const language of ['en', 'zh-CN']) {
    const owner = PairHint()
    const session = 'locale-' + language
    const first = owner.planRequest(session, [user('task'), assistant('read')], language)
    assert.equal(first.initialized, false)
    assert.equal(first.negotiationRequired, false)
    assert.equal(first.weak, null)
    assert.ok(tail(first, 'user'))
    assert.equal(tail(first, 'user'), tail(first, 'tool'), 'one owner decides the same initialization reminder')
    if (language === 'zh-CN') {
      assert.match(tail(first, 'user'), /估计第一个细粒度任务/)
      assert.doesNotMatch(tail(first, 'user'), /\[System:|Estimate the turnBudget|Then call/)
    } else assert.match(tail(first, 'user'), /Estimate the turnBudget/)
    owner.resetSession(session, 1)
    owner.startTurn(session)
    const reset = owner.planRequest(session, [user('task'), assistant('reset', 'resetScope'), result('reset')], language)
    assert.equal(reset.budget, 0)
    assert.ok(reset.weak)
    if (language === 'zh-CN') {
      assert.match(reset.weak, /已用尽|剩余 0/)
      assert.doesNotMatch(reset.weak, /\[System:|If you|when convenient|Weak, optional/)
    } else {
      assert.match(reset.weak, /turnBudget is exhausted/)
      assert.doesNotMatch(reset.weak, /If you are not busy/)
    }
    owner.clearSession(session)
  }
})

test('SPEC[pair-hint-009] Chinese first-negotiate mandatory instruction is exclusive and reply steer localized', () => {
  const owner = PairHint()
  const session = 'negotiation-zh'
  owner.bindDelegation(session, 'delegator')
  const prompt = owner.planRequest(session, [user('assignment'), assistant('read')], 'zh-CN')
  assert.equal(prompt.negotiationRequired, true)
  assert.match(tail(prompt, 'user'), /先调用 negotiate/)
  assert.doesNotMatch(tail(prompt, 'user'), /\[System:|Ask the delegator|Then call resetScope immediately/)
  assert.equal(prompt.hints.some(h => h.kind === 'tool'), true, 'pending tool calls carry mandatory negotiate reminder')
  assert.match(prompt.hints.find(h => h.kind === 'tool').tail, /先调用 negotiate/)
  const asked = owner.askNegotiation(session, '哪些具体资料已核实？')
  assert.equal(asked.ok, true)
  const prepared = owner.prepareNegotiationReply(asked.receipt, '已经核对来源文件。', 'zh-CN')
  assert.equal(prepared.ok, true)
  assert.match(prepared.steer, /^委托者已回答 negotiate\(questions\)/)
  assert.doesNotMatch(prepared.steer, /^Delegator answered/)
  assert.equal(owner.confirmNegotiationSteer(asked.receipt, session), true)
  const next = owner.planRequest(session, [user('assignment'), user('steer', 2)], 'zh-CN')
  assert.match(next.hints.at(-1).tail, /估计第一个细粒度任务/)
  owner.clearSession(session)
})

test('SPEC[pair-hint-009] first rendered tool suffix stays exactly frozen when the provider language changes mid-epoch', () => {
  const owner = PairHint()
  const session = 'frozen-locale-switch'
  const base = [user('assignment'), assistant('r0', 'resetScope'), assistant('read', 'read')]
  owner.planRequest(session, [base[0]], 'zh-CN')
  owner.resetSession(session, 3)
  const earlier = owner.planRequest(session, base, 'zh-CN')
  const pinned = earlier.hints.find(h => h.index === 1).tail
  assert.equal(pinned, '[Remaining turnBudget: 3]', 'wire budget format is a protocol sentinel, not an English instruction')
  owner.startTurn(session)
  const newer = owner.planRequest(session, [...base, assistant('next')], 'en')
  assert.equal(newer.hints.find(h => h.index === 1).tail, pinned)
  assert.equal(newer.hints.find(h => h.index === 3).tail, '[Remaining turnBudget: 2]')
  owner.clearSession(session)
})

test('SPEC[pair-hint-009] unsupported language cannot silently render English and leak it into Chinese sessions', () => {
  const owner = PairHint()
  assert.throws(() => owner.planRequest('unrecognized', [user('prompt')], 'xx-ZZ'), /language|Expected/)
  owner.clearSession('unrecognized')
})

test('SPEC[pair-hint-009] rejected negotiation operations use Chinese, not default English, when bound to zh-CN', () => {
  const owner = PairHint()
  const missing = owner.askNegotiation('not-delegated', '求证', 'zh-CN')
  assert.equal(missing.ok, false)
  assert.match(missing.reason, /不是受委托会话/)
  assert.doesNotMatch(missing.reason, /not a delegated session/)
  owner.bindDelegation('zh-delegate', 'parent')
  const blank = owner.askNegotiation('zh-delegate', '   ', 'zh-CN')
  assert.equal(blank.ok, false)
  assert.match(blank.reason, /不得为空/)
  const unknown = owner.prepareNegotiationReply('missing-receipt', '答复', 'zh-CN')
  assert.equal(unknown.ok, false)
  assert.match(unknown.reason, /未知或已结算/)
  owner.clearSession('zh-delegate')
})
