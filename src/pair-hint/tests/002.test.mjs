import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const owner=PairHint()
const SEP='\0\uFEFF'
const user=(text)=>({info:{role:'user',id:'u1'},parts:[{type:'text',text}]})
const result=(field,value,status='completed')=>({info:{role:'assistant'},parts:[{type:'tool',tool:'read',callID:'r1',state:{status,[field]:value}}]})

test('SPEC[pair-hint-002] user hint hotpatch writes only inside the request-copy part and remains idempotent',()=>{
  const raw=user('task')
  const changed=owner.writeUserHint(raw,['<system>guidance</system>'])
  assert.equal(changed.parts[0].text,'task'+SEP+'<system>guidance</system>')
  assert.equal(raw.parts[0].text,'task')
  assert.equal(changed.content,undefined)
  assert.equal(owner.writeUserHint(changed,['<system>guidance</system>']),changed)
  assert.equal(owner.stripKnownHints(changed,['<system>guidance</system>']).parts[0].text,'task')
})

test('SPEC[pair-hint-002] completed and failed tool results have distinct physical text fields',()=>{
  const complete=result('output','data')
  const failed=result('error','bad call','error')
  const pending=result('output','not ready','running')
  assert.equal(owner.writeToolResultHint(complete,['marker']).parts[0].state.output,'data'+SEP+'marker')
  assert.equal(owner.writeToolResultHint(failed,['marker']).parts[0].state.error,'bad call'+SEP+'marker')
  assert.equal(owner.writeToolResultHint(pending,['marker']),pending)
  assert.equal(complete.parts[0].state.output,'data')
})
