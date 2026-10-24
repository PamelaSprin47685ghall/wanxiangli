import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const owner = PairHint()
const user = (key) => ({ kind: 'user', operator: true, key, timestamp: 1, parts: [] })
const assistant = (...parts) => ({ kind: 'assistant', operator: false, parts })
const result = (id) => ({ kind: 'result', operator: false, parts: [], resultFor: id, resultField: 'content' })
const call = (id, tool) => ({ id, tool })

test('SPEC[pair-hint-001] last reset removes prior work and keeps all operator messages and older reset pairs', () => {
  const raw = [user('start'), assistant(call('r1','resetScope')), result('r1'), assistant(call('read','read')), result('read'), user('steer'), assistant(call('r2','resetScope')), result('r2'), assistant(call('new','read')), result('new')]
  const slots = owner.planFilter(raw)
  assert.deepEqual(slots.map(s => s.index), [0, 1, 2, 5, 6, 7, 8, 9])
  assert.deepEqual(raw[3].parts, [call('read','read')])
})

test('SPEC[pair-hint-001] same-batch reset barrier drops earlier calls and matches tool result ids', () => {
  const raw = [user('goal'), assistant(call('before','read'),call('reset','resetScope'),call('after','read')),result('before'),result('reset'),result('after')]
  const slots = owner.planFilter(raw)
  assert.deepEqual(slots.map(s => s.index), [0,1,3,4])
  assert.deepEqual(Array.from(slots[1].parts), [1,2])
})

test('SPEC[pair-hint-001] side prompts do not split or reset the operator scope', () => {
  const sid='pair-hint-side'
  owner.planRequest(sid,[user('start')])
  owner.resetSession(sid,4)
  const side={kind:'user',operator:false,sideRequest:true,key:'title',timestamp:100,parts:[]}
  const plan=owner.planRequest(sid,[user('start'),assistant(call('r','resetScope')),side])
  assert.equal(plan.weak,null)
  assert.equal(owner.turnBudget(sid),4)
  owner.clearSession(sid)
})
