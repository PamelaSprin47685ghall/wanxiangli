import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

test('SPEC[pair-hint-013] prior-scope readonly temporary owns only its source identity, not a frozen full transcript', () => {
  const owner=PairHint()
  const session='scope-013', temp='scope-consultation-013'
  const previous={system:['Actual previous system'],model:{providerID:'p',modelID:'m',variant:'high'}}
  const before={info:{sessionID:session,role:'user'},parts:[{type:'text',text:'original text'}]}
  const reset={info:{role:'assistant'},parts:[{type:'toolCall',id:'r',name:'resetScope'}]}
  owner.rememberTransform(session,[before,reset,{role:'user',content:'SECRET_CURRENT_SCOPE'}],
    [{role:'user',content:'current summarized scope'}])
  assert.equal(owner.startTemporaryPrevious(temp,session,{system:[],model:null}).ok,false)
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
  assert.equal(messages[0].parts[0].text,'original text','latest-view snapshot cannot alias mutable caller data')
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

test('SPEC[pair-hint-013] previous Scope uses the latest physical history at question time but cannot leak work after the last reset',()=>{
  const owner=PairHint(),sid='reanchored-prior-013',temp='ask-prior-live-013'
  const before={info:{role:'user'},parts:[{type:'text',text:'Original requirement'}]}
  const old={info:{role:'assistant'},parts:[{type:'text',text:'Old proof 112358'}]}
  const reset={info:{role:'assistant'},parts:[{type:'text',text:'Old summary'},{type:'tool',id:'reset-call',name:'resetScope'}]}
  const newUser={info:{role:'user'},parts:[{type:'text',text:'SECRET_NEW_SCOPE_271828'}]}
  const current={info:{role:'assistant'},parts:[{type:'text',text:'Current answer only'}]}
  owner.rememberSystem(sid,['Current system'])
  owner.rememberModel(sid,{providerID:'p',modelID:'new'})
  owner.rememberMessages(sid,[before,old,reset,newUser,current])
  const meta={system:['Previous real system'],model:{providerID:'p',modelID:'old'}}
  assert.equal(owner.startTemporaryPrevious(temp,sid,meta).ok,true)
  owner.rememberMessages(sid,[before,{...old,parts:[{type:'text',text:'Old proof updated before question 112358'}]},reset,newUser,current])
  const question={info:{role:'user'},parts:[{type:'text',text:'What did you observe?'}]}
  const out=owner.projectMessages(temp,question)
  assert.equal(out.length,4)
  assert.equal(out[1].parts[0].text,'Old proof updated before question 112358')
  assert.equal(out[2].parts[0].text,'Old summary')
  assert.equal(out.some(x=>JSON.stringify(x).includes('SECRET_NEW_SCOPE_271828')),false)
  assert.equal(out.some(x=>JSON.stringify(x).includes('Current answer only')),false)
  assert.deepEqual(owner.projectSystem(temp,[]),meta.system)
  assert.deepEqual(owner.modelForTemporary(temp),meta.model)
  owner.finishTemporary(temp)
  const cannot=owner.startTemporaryPrevious(temp,sid,meta)
  assert.equal(cannot.ok,true)
  owner.finishTemporary(temp)
  const bad='missing-reset-013'
  owner.rememberMessages(bad,[before,old,newUser])
  assert.equal(owner.startTemporaryPrevious(temp,bad,meta).ok,true,'registration stores identity, not a frozen source')
  assert.equal(owner.projectMessages(temp,question),null,'the actual model request must fail closed without a real last-reset boundary')
  owner.finishTemporary(temp)
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
  assert.equal(owner.startTemporaryPrevious(prior,sid,{system:['verified prior system'],model}).ok,true)
  const q=user('What evidence?')
  assert.deepEqual(owner.projectMessages(live,q),[...secondOutput,q],
    'live worker must consult the latest transform output')
  assert.deepEqual(owner.projectMessages(prior,q),[user('OLD_INPUT_314159'),q],
    'previous scope must consult the latest transform input, not the purged output')
  assert.equal(JSON.stringify(owner.projectMessages(prior,q)).includes('PRIVATE_NEW_SCOPE'),false)
  const thirdInput=[user('Third request without old reset boundary')]
  owner.rememberTransform(sid,thirdInput,thirdInput)
  assert.deepEqual(owner.projectMessages(live,q),[...thirdInput,q])
  assert.equal(owner.projectMessages(prior,q),null,
    'replacing latest view must NOT secretly keep an older full history in another dictionary')
  owner.finishTemporary(live)
  owner.finishTemporary(prior)
  owner.forgetSession(sid)
  assert.equal(owner.modelFor(sid),null)
})
