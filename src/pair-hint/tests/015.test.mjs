import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'
import { ScopeProgress } from '../../../dist/scope-progress/AdvisorFlow.js'

const user=(key,time)=>({kind:'user',operator:true,key,timestamp:time,parts:[]})
const call=(id,tool)=>({kind:'assistant',operator:false,parts:[{id,tool,terminalField:'output'}]})
const result=id=>({kind:'result',operator:false,resultFor:id,resultField:'content',parts:[]})

test('SPEC[pair-hint-015] cold history is not falsely interpreted as known progress, nor as a reset debt',()=>{
  const owner=PairHint(),progress=ScopeProgress(),sid='cold-progress-015'
  const history=[user('first',1),call('reset-1','resetScope'),result('reset-1'),
    user('later',2),call('read-1','read'),result('read-1')]
  const before=structuredClone(history)
  const plan=owner.planRequest(sid,history,'zh-CN')
  assert.equal(progress.status(sid).known,false)
  assert.equal(plan.strong,null,'ScopeProgress, not historical reset appearances, owns first estimate prompting')
  assert.equal(plan.weak,null)
  assert.deepEqual(plan.hints,[])
  assert.deepEqual(history,before,'old provider history bytes remain intact')
  owner.startTurn(sid)
  const later=owner.planRequest(sid,[...history,user('new operator instruction',3)],'zh-CN')
  assert.equal(later.strong,null)
  assert.deepEqual(later.hints,[])
  owner.clearSession(sid)
})

test('SPEC[pair-hint-015] real progress accounting lives only in ScopeProgress; no old countdown suffix or weak advice',()=>{
  const owner=PairHint(),progress=ScopeProgress(),sid='known-progress-015'
  const history=[user('first',1),call('old-reset','resetScope'),result('old-reset')]
  owner.planRequest(sid,history,'en')
  owner.resetSession(sid,0)
  const view=owner.planRequest(sid,[...history,call('read','read'),result('read')],'en')
  assert.deepEqual(view.hints,[])
  assert.equal(view.strong,null)
  assert.equal(view.weak,null)
  progress.record(sid,'epoch','run-one','todo-one',2)
  assert.equal(progress.settle(sid,'epoch','run-one').estimate,2)
  progress.record(sid,'epoch','run-two','todo-two',0)
  assert.equal(progress.settle(sid,'epoch','run-two').resetDue,true)
  const unchanged=owner.planRequest(sid,[...history,user('later',2)],'en')
  assert.equal(unchanged.strong,null,'ResetDue steer belongs to the progress owner at the Host boundary')
  assert.equal(unchanged.weak,null)
  assert.deepEqual(unchanged.hints,[])
  owner.clearSession(sid)
})
