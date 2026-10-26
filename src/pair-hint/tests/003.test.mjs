import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const owner=PairHint()
const user=(key,timestamp=1)=>({kind:'user',operator:true,key,timestamp,parts:[]})
const call=(id,tool,terminalField='')=>({id,tool,terminalField})
const assistant=(...parts)=>({kind:'assistant',operator:false,parts})
const result=id=>({kind:'result',operator:false,resultFor:id,resultField:'content',parts:[]})

test('SPEC[pair-hint-003] historical marker helper appends a literal separator once, without changing its input',()=>{
  const text='output'
  const suffix='historical text'
  const once=owner.appendTailOnce(text,suffix)
  assert.equal(once,'output\0\uFEFF'+suffix)
  assert.equal(owner.appendTailOnce(once,suffix),once)
  assert.equal(text,'output')
})

test('SPEC[pair-hint-003] initial Scope progress hints are delegated to ScopeProgress, not PairHint tool tails',()=>{
  const sid='neutral-init-tail'
  const initial=owner.planRequest(sid,[user('start'),assistant(call('read','read','output'))])
  assert.equal(initial.strong,null)
  assert.deepEqual(initial.hints,[])
  const after=owner.planRequest(sid,[user('start'),assistant(call('read','read','output'),call('reset','resetScope','output'))])
  assert.equal(after.strong,null)
  assert.equal(after.weak,null)
  assert.deepEqual(after.hints,[])
  owner.clearSession(sid)
})

test('SPEC[pair-hint-003] a legacy exhausted budget is not interpreted as a new ScopeProgress ResetDue',()=>{
  const sid='neutral-zero'
  owner.planRequest(sid,[user('start')])
  owner.resetSession(sid,1)
  owner.startTurn(sid)
  const plan=owner.planRequest(sid,[user('start'),assistant(call('reset','resetScope')),result('reset')])
  assert.equal(plan.strong,null)
  assert.equal(plan.weak,null)
  assert.deepEqual(plan.hints,[])
  owner.clearSession(sid)
})
