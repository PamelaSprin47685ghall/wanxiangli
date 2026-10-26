import assert from 'node:assert/strict'
import test from 'node:test'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const user = (key, time = 1) => ({ kind: 'user', operator: true, key, timestamp: time, parts: [] })
const assistant = (id, name = 'read', terminalField = 'output') => ({
  kind: 'assistant', operator: false, parts: [{ id, tool: name, terminalField }],
})
const result = id => ({ kind: 'result', operator: false, resultFor: id, resultField: 'content', parts: [] })
const tail = (plan, kind) => plan.hints.find(h => h.kind === kind)?.tail

test('SPEC[pair-hint-009] ordinary requests have no legacy budget reminders in either provider language', () => {
  for (const language of ['en', 'zh-CN']) {
    const owner=PairHint(), session='locale-'+language
    const raw=[user('task'),assistant('read')]
    const first=owner.planRequest(session,raw,language)
    assert.equal(first.strong,null)
    assert.equal(first.weak,null)
    assert.deepEqual(first.hints,[])
    owner.resetSession(session,0)
    const again=owner.planRequest(session,[...raw,assistant('reset','resetScope'),result('reset')],language)
    assert.equal(again.strong,null)
    assert.equal(again.weak,null)
    assert.deepEqual(again.hints,[])
    owner.clearSession(session)
  }
})

test('SPEC[pair-hint-009] Chinese first-negotiate mandatory instruction is exclusive and reply steer localized', () => {
  const owner = PairHint()
  const session = 'negotiation-zh'
  owner.bindDelegation(session, 'delegator')
  const prompt = owner.planRequest(session, [user('assignment'), assistant('read')], 'zh-CN')
  assert.equal(prompt.negotiationRequired, true)
  assert.match(prompt.strong, /先调用 negotiate/)
  assert.doesNotMatch(prompt.strong, /\[System:|Ask the delegator|Then call resetScope immediately/)
  assert.equal(prompt.hints.length, 0, 'mandatory negotiation rides on a strong steer, not tool results')
  const asked = owner.askNegotiation(session, '哪些具体资料已核实？')
  assert.equal(asked.ok, true)
  const prepared = owner.prepareNegotiationReply(asked.receipt, '已经核对来源文件。', 'zh-CN')
  assert.equal(prepared.ok, true)
  assert.match(prepared.steer, /^委托者已回答 negotiate\(questions\)/)
  assert.doesNotMatch(prepared.steer, /^Delegator answered/)
  assert.equal(owner.confirmNegotiationSteer(asked.receipt, session), true)
  const next = owner.planRequest(session, [user('assignment'), user('steer', 2)], 'zh-CN')
  assert.equal(next.strong, null, 'progress initialization belongs to the dedicated progress owner')
  assert.equal(next.hints.length, 0)
  owner.clearSession(session)
})

test('SPEC[pair-hint-009] switching languages does not add or rewrite old tool output suffixes', () => {
  const owner=PairHint(),session='frozen-locale-switch'
  const base=[user('assignment'),assistant('r0','resetScope'),assistant('read','read')]
  const raw=structuredClone(base)
  owner.planRequest(session,[base[0]],'zh-CN')
  owner.resetSession(session,0)
  const first=owner.planRequest(session,base,'zh-CN')
  const later=owner.planRequest(session,[...base,assistant('next')],'en')
  assert.deepEqual(first.hints,[])
  assert.deepEqual(later.hints,[])
  assert.equal(later.strong,null)
  assert.deepEqual(base,raw)
  owner.clearSession(session)
})

test('SPEC[pair-hint-009] unsupported language cannot silently render English and leak it into Chinese sessions', () => {
  const owner = PairHint()
  owner.bindDelegation('unrecognized','parent')
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
