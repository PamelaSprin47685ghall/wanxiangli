import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const user = (key, time, operator = true) => ({kind:'user',operator,key,timestamp:time,parts:[]})
const call = (id, tool = 'read', terminalField = 'output') => ({kind:'assistant',operator:false,parts:[{id,tool,terminalField}]})
const result = id => ({kind:'result',operator:false,resultFor:id,resultField:'content',parts:[]})
const toolHint = (plan, index) => plan.hints.find(h => h.kind==='tool' && h.index===index)

test('SPEC[pair-hint-014] before an estimate PairHint does not fabricate reset advice; ScopeProgress owns the independent strong steer', () => {
  const owner = PairHint(), sid='first-scope-014'
  const raw=[user('first',1),call('read-1'),result('read-1')]
  const initial=owner.planRequest(sid,raw,'zh-CN')
  assert.equal(initial.initialized,false)
  assert.equal(initial.strong,null)
  assert.equal(initial.weak,null)
  assert.deepEqual(initial.hints,[])
  assert.equal(initial.budget,0)
  const next=owner.planRequest(sid,[...raw,call('read-2'),result('read-2')],'zh-CN')
  assert.equal(next.strong,null)
  assert.deepEqual(next.hints,[])
  assert.equal(next.weak,null)
  assert.equal(raw.length,3,'raw provider history is not changed by the planner')
  const preview=owner.planRequest(sid,[...raw,{kind:'user',operator:false,sideRequest:true,key:'preview',parts:[]}],'zh-CN')
  assert.equal(preview.strong,null,'an ephemeral side request is not a new main-turn obligation')
  assert.equal(preview.weak,null)
  assert.deepEqual(preview.hints,[])
  owner.clearSession(sid)
})

test('SPEC[pair-hint-014] after a reset, later operator messages and agent-attributed user steers do not invalidate budget or prompt another reset', () => {
  const owner=PairHint(), sid='continuation-014'
  const base=[user('original',1),call('reset','resetScope'),result('reset')]
  owner.planRequest(sid,[base[0]],'zh-CN')
  owner.resetSession(sid,6)
  const first=owner.planRequest(sid,base,'zh-CN')
  assert.equal(first.initialized,true)
  assert.equal(first.strong,null)
  const pinned=toolHint(first,2)?.tail
  assert.equal(pinned,undefined,'tool-result budget suffixes were retired')
  owner.startTurn(sid)
  const later=[...base,user('real-next-task',2),user('negotiate-reply',3,false),call('read'),result('read')]
  const continuation=owner.planRequest(sid,later,'zh-CN')
  assert.equal(continuation.initialized,true)
  assert.deepEqual(continuation.hints,[],'operator and agent messages cannot create an old budget suffix')
  assert.equal(continuation.strong,null)
  assert.equal(continuation.weak,null)
  assert.equal(continuation.hints.some(h=>h.kind==='user'),false)
  assert.equal(toolHint(continuation,2)?.tail,pinned,'historical suffix pinned')
  assert.equal(toolHint(continuation,6)?.tail,undefined)
  owner.startTurn(sid)
  assert.deepEqual(continuation.hints,[])
  const further=owner.planRequest(sid,[...later,user('real-third-message',4)],'zh-CN')
  assert.deepEqual(further.hints,[])
  assert.equal(further.initialized,true)
  assert.equal(further.strong,null)
  assert.equal(further.hints.some(h=>h.kind==='user'),false)
  owner.clearSession(sid)
})

test('SPEC[pair-hint-014] mandatory negotiate before first reset and askPrevious after later reset use strong steers rather than tool suffixes',()=>{
  const owner=PairHint(), sid='initial-negotiate-014'
  owner.bindDelegation(sid,'delegator')
  const raw=[user('delegation',1),call('read-1'),result('read-1')]
  const awaiting=owner.planRequest(sid,raw,'en')
  assert.match(awaiting.strong,/negotiate\(questions/)
  assert.deepEqual(awaiting.hints,[])
  assert.equal(awaiting.weak,null)
  const accepted=owner.askNegotiation(sid,'What evidence?')
  const prepared=owner.prepareNegotiationReply(accepted.receipt,'Evidence 42')
  assert.equal(prepared.ok,true)
  assert.equal(owner.confirmNegotiationSteer(accepted.receipt,sid),true)
  const initial=owner.planRequest(sid,[...raw,user('agent-steer',2,false)],'en')
  assert.equal(initial.strong,null,'baseline reporting belongs to ScopeProgress')
  assert.deepEqual(initial.hints,[])
  owner.resetSession(sid,7)
  assert.equal(owner.planRequest(sid,[...raw,call('reset','resetScope')],'en').strong,null)
  owner.beginAskPreviousScope(sid)
  const pending=owner.planRequest(sid,[...raw,call('reset','resetScope'),call('read-2')],'en')
  assert.match(pending.strong,/askPreviousScope\(questions/)
  assert.equal(pending.hints.length,0)
  owner.setHasPreviousScope(sid,true)
  const asked=owner.askPreviousScope(sid,'What exact evidence?', 'ask-call-014')
  assert.equal(asked.ok,true)
  assert.equal(owner.planRequest(sid,[...raw,call('reset','resetScope')],'en').strong,null)
  owner.clearSession(sid)
})

test('SPEC[pair-hint-014] old agent-attributed user replies are not operator messages for any reset or history retention',()=>{
  const owner=PairHint()
  const history=[user('operator-start',1), user('agent-reply-old',2,false),call('reset','resetScope'),result('reset'),user('agent-reply-new',3,false),user('operator-follow-up',4)]
  const selected=owner.planFilter(history).map(x=>x.index)
  assert.deepEqual(selected,[0,2,3,4,5], 'previous epoch agent steer is old process, not an operator message')
  const plan=owner.planRequest('agent-authorship-014',history,'en')
  assert.equal(plan.strong,null,'cold initial estimate is decided by ScopeProgress')
  owner.clearSession('agent-authorship-014')
})

test('SPEC[pair-hint-014] a cold session with reset history does not fabricate old budget hints',()=>{
  const owner=PairHint(), sid='cold-rehydrated-014'
  const outcome=owner.planRequest(sid,[user('old',1),call('reset','resetScope'),result('reset'),user('new',2)],'en')
  assert.equal(outcome.strong,null,'cold recovery no longer guesses a reset obligation')
  assert.equal(outcome.initialized,false)
  assert.equal(outcome.hints.some(h=>h.kind==='user'),false)
  owner.clearSession(sid)
})
