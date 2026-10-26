import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'
const owner=PairHint()
const user=(key,time)=>({kind:'user',operator:true,key,timestamp:time,parts:[]})
const reset=()=>({kind:'assistant',operator:false,parts:[{id:'r1',tool:'resetScope'}]})

test('SPEC[pair-hint-004] later genuine user instructions stay in the same Scope without creating reset reminders',()=>{
  const sid='state-next-prompt', first=user('start',10)
  owner.planRequest(sid,[first])
  owner.resetSession(sid,0)
  const initial=owner.planRequest(sid,[first,reset()])
  assert.equal(initial.strong,null)
  owner.startTurn(sid)
  const next=owner.planRequest(sid,[first,reset(),user('change',20)])
  assert.equal(next.strong,null)
  assert.equal(next.weak,null)
  assert.equal(next.hints.length,0)
  assert.equal(owner.isInitialized(sid),true)
  owner.clearSession(sid)
})

test('SPEC[pair-hint-004] re-reading old user prompts does not recreate negotiation or reset pending',()=>{
  const sid='state-stale'
  const first=user('first',10),second=user('second',20)
  owner.planRequest(sid,[first,second])
  owner.resetSession(sid,0)
  const reloaded=owner.planRequest(sid,[first])
  assert.equal(reloaded.strong,null)
  assert.equal(reloaded.pendingKind,'none')
  owner.clearSession(sid)
})
