import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const owner=PairHint()
const user=(key,timestamp=1)=>({kind:'user',operator:true,key,timestamp,parts:[]})
const call=(id,tool,terminalField='')=>({id,tool,terminalField})
const assistant=(...parts)=>({kind:'assistant',operator:false,parts})
const result=id=>({kind:'result',operator:false,resultFor:id,resultField:'content',parts:[]})

test('SPEC[pair-hint-003] prefix separator is appended once and only to provider copy',()=>{
  const text='output'
  const suffix='[Remaining turnBudget: 2]'
  const once=owner.appendTailOnce(text,suffix)
  assert.equal(once,'output\0\uFEFF'+suffix)
  assert.equal(owner.appendTailOnce(once,suffix),once)
  assert.equal(text,'output')
})

test('SPEC[pair-hint-003] uninitialized active output gets the reminder and reset output gets the new budget',()=>{
  const sid='neutral-init-tail'
  const initial=owner.planRequest(sid,[user('start'),assistant(call('read','read','output'))])
  assert.match(initial.strong,/Then call resetScope immediately/)
  assert.deepEqual(initial.hints,[], 'initialization is an independent strong steer, not a tool suffix')
  const after=owner.planRequest(sid,[user('start'),assistant(call('read','read','output'),call('reset','resetScope','output'))])
  assert.equal(after.hints.filter(h=>h.kind==='tool').length,1,'the read before reset has been purged')
  assert.equal(after.hints.find(h=>h.kind==='tool').tail,'[Remaining turnBudget: 0]')
  owner.clearSession(sid)
})

test('SPEC[pair-hint-003] initialized exhausted budget makes only a weak, optional steer',()=>{
  const sid='neutral-zero'
  owner.planRequest(sid,[user('start')])
  owner.resetSession(sid,1)
  owner.startTurn(sid)
  const plan=owner.planRequest(sid,[user('start'),assistant(call('reset','resetScope')),result('reset')])
  assert.match(plan.weak,/Do not interrupt, pause, or abandon/)
  assert.equal(plan.budget,0)
  owner.clearSession(sid)
})
