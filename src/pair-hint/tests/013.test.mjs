import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

test('SPEC[pair-hint-013] prior-scope readonly temporary asks through the sealed equivalent view of the previous Scope', () => {
  const owner=PairHint()
  const session='scope-013', temp='scope-consultation-013'
  const before={info:{sessionID:session,role:'user'},parts:[{type:'text',text:'original text'}]}
  const previous={system:['Actual previous system'],model:{providerID:'p',modelID:'m',variant:'high'},messages:[before]}
  const reset={info:{role:'assistant'},parts:[{type:'toolCall',id:'r',name:'resetScope'}]}
  owner.rememberTransform(session,[before,reset,{role:'user',content:'SECRET_CURRENT_SCOPE'}],
    [{role:'user',content:'current summarized scope'}])
  assert.equal(owner.startTemporaryPrevious(temp,session,{system:[],model:null}).ok,false)
  assert.equal(owner.startTemporaryPrevious(temp,session,{system:['s'],model:{providerID:'p',modelID:'m'}}).ok,false,
    'no sealed equivalent view, no consultation')
  assert.equal(owner.startTemporaryPrevious(temp,session,previous).ok,true)
  assert.equal(owner.isTemporary(temp),true)
  assert.deepEqual(owner.modelForTemporary(temp),previous.model)
  assert.deepEqual(owner.projectSystem(temp,[]),previous.system)
  const question={info:{role:'user'},parts:[{type:'text',text:'What was decided?'}]}
  const messages=owner.projectMessages(temp,question)
  assert.equal(messages.length,2)
  assert.deepEqual(messages[0],before)
  assert.deepEqual(messages[1],question)
  assert.equal(JSON.stringify(messages).includes('SECRET_CURRENT_SCOPE'),false)
  before.parts[0].text='changed only in caller'
  assert.equal(messages[0].parts[0].text,'original text','equivalent-view snapshot cannot alias mutable caller data')
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
  assert.equal(owner.askPreviousScope(session,'What did we decide?','epoch-1:call-1').replayed,true,
    'a physical reply must not erase the exact original question identity for later toolcall replay')
  assert.equal(owner.preparePreviousScopeReply(first.receipt,session,'duplicate answer','zh-CN').ok,false,
    'a physically accepted reply cannot be prepared a second time')
  owner.clearSession(session)
  assert.equal(owner.preparePreviousScopeReply(next.receipt,session,'late','zh-CN').ok,false,'deleted session cannot accept late reply')
})

test('SPEC[pair-hint-013] live BTW resolves the latest delegator provider view when the temporary provider hook fires, without copying a frozen conversation into its registration', () => {
  const owner=PairHint(), source='delegator-dynamic-013', temp='temporary-dynamic-013'
  const old=[{info:{role:'user'},parts:[{type:'text',text:'Earlier goal'}]}]
  owner.rememberMessages(source,old)
  owner.rememberSystem(source,['system-old'])
  owner.rememberModel(source,{providerID:'p',modelID:'first'})
  assert.equal(owner.startTemporary(temp,source).ok,true)
  const later=[...old,{info:{role:'assistant'},parts:[{type:'text',text:'New discovery 271828'}]}]
  owner.rememberMessages(source,later)
  owner.rememberSystem(source,['system-latest'])
  owner.rememberModel(source,{providerID:'p',modelID:'second'})
  const q={info:{role:'user'},parts:[{type:'text',text:'What did we learn?'}]}
  assert.deepEqual(owner.projectSystem(temp,['ephemeral-system']),['system-latest'])
  assert.equal(owner.modelForTemporary(temp).modelID,'second')
  const messages=owner.projectMessages(temp,q)
  assert.equal(messages.length,3)
  assert.equal(messages[1].parts[0].text,'New discovery 271828')
  assert.deepEqual(messages[2],q)
  later[1].parts[0].text='mutated by caller after observation'
  assert.equal(messages[1].parts[0].text,'New discovery 271828')
  owner.finishTemporary(temp)
  assert.equal(owner.isTemporary(temp),false)
  assert.equal(owner.projectMessages(temp,q),null)
})

test('SPEC[pair-hint-013] previous Scope is asked through its sealed equivalent view, never the raw Host history nor new-Scope work',()=>{
  const owner=PairHint(),sid='reanchored-prior-013',temp='ask-prior-live-013'
  const before={info:{role:'user'},parts:[{type:'text',text:'Original requirement'}]}
  const old={info:{role:'assistant'},parts:[{type:'text',text:'Old proof 112358'}]}
  const rawEarlier={info:{role:'assistant'},parts:[{type:'text',text:'RAW_RETIRED_HISTORY_999'}]}
  const reset={info:{role:'assistant'},parts:[{type:'text',text:'Old summary'},{type:'tool',id:'reset-call',name:'resetScope'}]}
  const newUser={info:{role:'user'},parts:[{type:'text',text:'SECRET_NEW_SCOPE_271828'}]}
  const current={info:{role:'assistant'},parts:[{type:'text',text:'Current answer only'}]}
  owner.rememberSystem(sid,['Current system'])
  owner.rememberModel(sid,{providerID:'p',modelID:'new'})
  owner.rememberMessages(sid,[rawEarlier,before,old,reset,newUser,current])
  // The sealed provider view the old Scope actually sent (projected, within its window).
  const meta={system:['Previous real system'],model:{providerID:'p',modelID:'old'},messages:[before,old]}
  assert.equal(owner.startTemporaryPrevious(temp,sid,meta).ok,true)
  owner.rememberMessages(sid,[rawEarlier,before,{...old,parts:[{type:'text',text:'later raw edit'}]},reset,newUser,current])
  const question={info:{role:'user'},parts:[{type:'text',text:'What did you observe?'}]}
  const out=owner.projectMessages(temp,question)
  assert.deepEqual(out,[before,old,question])
  const wire=JSON.stringify(out)
  assert.equal(wire.includes('RAW_RETIRED_HISTORY_999'),false,'raw Host history is not the previous Scope view')
  assert.equal(wire.includes('later raw edit'),false,'equivalent view is the sealed one, not a later raw read')
  assert.equal(wire.includes('SECRET_NEW_SCOPE_271828'),false)
  assert.equal(wire.includes('Current answer only'),false)
  assert.deepEqual(owner.projectSystem(temp,[]),meta.system)
  assert.deepEqual(owner.modelForTemporary(temp),meta.model)
  meta.messages[1].parts[0].text='caller mutation'
  assert.equal(owner.projectMessages(temp,question)[1].parts[0].text,'Old proof 112358')
  owner.finishTemporary(temp)
  assert.equal(owner.projectMessages(temp,question),null)
})

test('SPEC[pair-hint-013] one latest LLM transform input/output replaces all earlier versions and serves three consultation projections', () => {
  const owner=PairHint()
  const sid='one-owner-latest-transform-013'
  const live='live-temp-single-013',prior='prior-temp-single-013'
  const user=(text)=>({role:'user',content:text})
  const system=['system truth from real request']
  const model={providerID:'fixture',modelID:'one'}
  owner.rememberSystem(sid,system)
  owner.rememberModel(sid,model)
  owner.rememberTransform(sid,[user('first baseline')],[user('first baseline')])
  assert.equal(owner.startTemporary(live,sid).ok,true)
  const reset={role:'assistant',content:[{type:'toolCall',id:'reset-1',name:'resetScope'}]}
  const secondInput=[user('OLD_INPUT_314159'),reset,user('PRIVATE_NEW_SCOPE_271828')]
  const secondOutput=[user('OLD_OUTPUT_SUMMARY_ONLY'),user('PRIVATE_NEW_SCOPE_271828')]
  owner.rememberTransform(sid,secondInput,secondOutput)
  const sealedPrior=[user('OLD_SEALED_VIEW_314159')]
  assert.equal(owner.startTemporaryPrevious(prior,sid,{system:['verified prior system'],model,messages:sealedPrior}).ok,true)
  const q=user('What evidence?')
  assert.deepEqual(owner.projectMessages(live,q),[...secondOutput,q],
    'live worker must consult the latest transform output')
  assert.deepEqual(owner.projectMessages(prior,q),[...sealedPrior,q],
    'previous scope consults its sealed equivalent view, not the raw input nor the purged output')
  assert.equal(JSON.stringify(owner.projectMessages(prior,q)).includes('PRIVATE_NEW_SCOPE'),false)
  const thirdInput=[user('Third request without old reset boundary')]
  owner.rememberTransform(sid,thirdInput,thirdInput)
  assert.deepEqual(owner.projectMessages(live,q),[...thirdInput,q])
  assert.deepEqual(owner.projectMessages(prior,q),[...sealedPrior,q],
    'a later work transform does not change the previous Scope equivalent view')
  owner.finishTemporary(live)
  owner.finishTemporary(prior)
  owner.forgetSession(sid)
  assert.equal(owner.modelFor(sid),null)
})
