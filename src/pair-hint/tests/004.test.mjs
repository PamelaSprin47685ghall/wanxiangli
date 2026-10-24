import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const owner=PairHint()
const user=(key,time)=>({kind:'user',operator:true,key,timestamp:time,parts:[]})
const reset=()=>({kind:'assistant',operator:false,parts:[{id:'r1',tool:'resetScope'}]})

test('SPEC[pair-hint-004] new operator prompt invalidates budget until reset is committed',()=>{
  const sid='state-next-prompt'
  const first=user('start',10)
  owner.planRequest(sid,[first])
  owner.resetSession(sid,5)
  assert.equal(owner.planRequest(sid,[first,reset()]).budget,5)
  owner.startTurn(sid)
  assert.equal(owner.turnBudget(sid),4)
  assert.equal(owner.planRequest(sid,[first,reset(),user('change',20)]).budget,0)
  assert.equal(owner.isInitialized(sid),false)
  owner.resetSession(sid,3)
  assert.equal(owner.turnBudget(sid),3)
  owner.clearSession(sid)
  assert.equal(owner.isInitialized(sid),false)
})

test('SPEC[pair-hint-004] old prompt snapshots cannot roll back the newer current budget',()=>{
  const sid='state-stale'
  const first=user('first',10)
  const second=user('second',20)
  owner.planRequest(sid,[first,second])
  owner.resetSession(sid,6)
  owner.planRequest(sid,[first])
  assert.equal(owner.turnBudget(sid),6)
  assert.equal(owner.isInitialized(sid),true)
  owner.clearSession(sid)
})
