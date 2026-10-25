import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

test('SPEC[pair-hint-013] frozen old provider wire shares readonly temporary lifecycle with negotiate', () => {
  const owner=PairHint()
  const session='scope-013', temp='scope-consultation-013'
  const raw={sessionId:session,
    system:['Actual previous system'],
    messages:[{info:{sessionID:session,role:'user'},parts:[{type:'text',text:'original text'}]}],
    model:{providerID:'p',modelID:'m',variant:'high'}}
  assert.equal(owner.startTemporaryFromFrozen(temp,{system:[],messages:[],model:null}).ok,false)
  assert.equal(owner.startTemporaryFromFrozen(temp,raw).ok,true)
  assert.equal(owner.isTemporary(temp),true)
  assert.deepEqual(owner.modelForTemporary(temp),raw.model)
  const system=owner.projectSystem(temp,['ephemeral system'])
  assert.deepEqual(system,raw.system)
  const question={info:{role:'user'},parts:[{type:'text',text:'What was decided?'}]}
  const messages=owner.projectMessages(temp,question)
  assert.equal(messages.length,2)
  assert.deepEqual(messages[0],raw.messages[0])
  assert.deepEqual(messages[1],question)
  raw.messages[0].parts[0].text='changed only in caller'
  assert.equal(messages[0].parts[0].text,'original text','frozen archive never follows later mutation')
  owner.recordToolViolation(temp)
  assert.equal(owner.toolViolationCount(temp),1)
  owner.finishTemporary(temp)
  assert.equal(owner.isTemporary(temp),false)
  assert.equal(owner.modelForTemporary(temp),null)
  owner.clearSession(session)
})

test('SPEC[pair-hint-013] previous-scope first ask is one real call, optional thereafter, replay idempotent, steer confirmation once',()=>{
  const owner=PairHint(), session='ask-013'
  const rejected=owner.askPreviousScope(session,'what changed?','call-before')
  assert.equal(rejected.ok,false)
  assert.match(rejected.reason,/NoPreviousScope/)
  owner.setHasPreviousScope(session,true)
  owner.beginAskPreviousScope(session)
  assert.equal(owner.isPreviousScopePending(session),true)
  const first=owner.askPreviousScope(session,'What did we decide?','epoch-1:call-1')
  assert.equal(first.ok,true)
  assert.equal(first.first,true)
  assert.equal(owner.isPreviousScopePending(session),false,'real valid call unlocks soft reminder without waiting for answer')
  const replay=owner.askPreviousScope(session,'What did we decide?','epoch-1:call-1')
  assert.equal(replay.replayed,true)
  assert.equal(owner.askPreviousScope(session,'DIFFERENT','epoch-1:call-1').ok,false,'toolcall identity cannot alter questions')
  const next=owner.askPreviousScope(session,'What exact evidence?','epoch-1:call-2')
  assert.equal(next.ok,true)
  assert.equal(next.first,false)
  const prepared=owner.preparePreviousScopeReply(first.receipt,session,'具体证据 37','zh-CN')
  assert.equal(prepared.ok,true)
  assert.match(prepared.steer,/^前一 Scope 的答复：/)
  assert.equal(owner.confirmPreviousScopeSteer(first.receipt,'other'),false)
  assert.equal(owner.confirmPreviousScopeSteer(first.receipt,session),true)
  assert.equal(owner.confirmPreviousScopeSteer(first.receipt,session),false)
  owner.clearSession(session)
  assert.equal(owner.preparePreviousScopeReply(next.receipt,session,'late','zh-CN').ok,false,'deleted session cannot accept late reply')
})
