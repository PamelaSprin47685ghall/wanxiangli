import assert from 'node:assert/strict'
import test from 'node:test'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const user=(key,time)=>({kind:'user',operator:true,key,timestamp:time,parts:[]})
const assistant=(id,tool,terminalField='output')=>({kind:'assistant',operator:false,parts:[{id,tool,terminalField}]})
const result=id=>({kind:'result',operator:false,resultFor:id,resultField:'content',parts:[]})

test('SPEC[pair-hint-007] an existing reset and ordinary tool output never acquire a synthetic countdown in later requests',()=>{
  const owner=PairHint(),sid='prefix-stable-opencode'
  const prompt=user('100:task',100),reset=assistant('reset-1','resetScope'),read=assistant('read-1','read')
  const raw=[prompt,reset,read],original=structuredClone(raw)
  owner.planRequest(sid,[prompt])
  owner.resetSession(sid,0)
  const previous=owner.planRequest(sid,[prompt,reset])
  owner.startTurn(sid)
  const current=owner.planRequest(sid,raw)
  assert.deepEqual(previous.hints,[])
  assert.deepEqual(current.hints,[])
  assert.equal(current.strong,null)
  assert.deepEqual(current.slots.map(x=>x.index),[0,1,2])
  assert.deepEqual(raw,original,'all historical bytes remain unchanged')
  owner.clearSession(sid)
})

test('SPEC[pair-hint-007] an agent-attributed answer and a later operator instruction do not rewrite OMP reset results',()=>{
  const owner=PairHint(),sid='prefix-stable-omp'
  const prompt=user('100:task',100),reset=assistant('r','resetScope',''),output=result('r')
  const raw=[prompt,reset,output,user('200:change',200)]
  const original=structuredClone(raw)
  owner.planRequest(sid,[prompt])
  owner.resetSession(sid,0)
  const first=owner.planRequest(sid,raw.slice(0,3))
  owner.startTurn(sid)
  const later=owner.planRequest(sid,raw)
  assert.deepEqual(first.hints,[])
  assert.deepEqual(later.hints,[])
  assert.equal(later.strong,null)
  assert.deepEqual(raw,original)
  owner.clearSession(sid)
})

test('SPEC[pair-hint-007] later reset reanchors tool history without recreating countdown suffixes',()=>{
  const owner=PairHint(),sid='prefix-reanchor'
  const prompt=user('100:task',100),first=assistant('r1','resetScope'),second=assistant('r2','resetScope')
  owner.planRequest(sid,[prompt])
  owner.resetSession(sid,0)
  const before=owner.planRequest(sid,[prompt,first])
  owner.resetSession(sid,0)
  const after=owner.planRequest(sid,[prompt,first,second])
  assert.deepEqual(before.hints,[])
  assert.deepEqual(after.hints,[])
  assert.deepEqual(after.slots.map(x=>x.index),[0,1,2])
  owner.clearSession(sid)
})

test('SPEC[pair-hint-007] side-request previews do not contaminate the next ordinary request',()=>{
  const owner=PairHint(),sid='prefix-side-preview'
  const prompt=user('100:task',100),reset=assistant('reset-1','resetScope'),read=assistant('read-1','read')
  const side={kind:'user',operator:false,sideRequest:true,parts:[]}
  const raw=[prompt,reset,read],original=structuredClone(raw)
  owner.planRequest(sid,[prompt])
  owner.resetSession(sid,0)
  const preview=owner.planRequest(sid,[...raw,side])
  const actual=owner.planRequest(sid,raw)
  assert.deepEqual(preview.hints,[])
  assert.deepEqual(actual.hints,[])
  assert.equal(preview.strong,null)
  assert.deepEqual(actual.slots.map(x=>x.index),[0,1,2])
  assert.deepEqual(raw,original)
  owner.clearSession(sid)
})
