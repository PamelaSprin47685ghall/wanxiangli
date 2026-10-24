import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'

const owner = PairHint()
const user = key => ({kind:'user',operator:true,key, timestamp:1, parts:[]})
const tool = (id,name='read') => ({kind:'assistant',operator:false,parts:[{id,tool:name,terminalField:'output'}]})

test('SPEC[pair-hint-008] a delegated assignment requires questions before any reset reminder', () => {
  const id='child-mandatory'
  owner.bindDelegation(id, 'parent')
  const plan = owner.planRequest(id,[user('task'),tool('read-1')])
  assert.equal(plan.negotiationRequired,true)
  assert.match(plan.hints[0].tail,/negotiate\(questions: string\) NOW/)
  assert.equal(plan.hints.some(x=>/resetScope immediately/.test(x.tail)),false)
  assert.equal(plan.hints.filter(x=>x.kind==='tool').length,0)
  const receipt=owner.askNegotiation(id,'Which module? What invariant?')
  assert.equal(receipt.ok,true)
  assert.equal(receipt.delegator,'parent')
  assert.equal(owner.negotiationRequired(id),true,'a sent receipt is not a reply')
  assert.equal(owner.prepareNegotiationReply(receipt.receipt,'').ok,false)
  const prepared=owner.prepareNegotiationReply(receipt.receipt,'Use the parser; keep input bytes.')
  assert.equal(prepared.ok,true)
  assert.match(prepared.steer,/Use the parser/)
  assert.equal(owner.negotiationRequired(id),true,'reply is not acknowledged until the steer is delivered')
  assert.equal(owner.completeNegotiationReply(receipt.receipt),true)
  assert.equal(owner.completeNegotiationReply(receipt.receipt),false)
  assert.equal(owner.negotiationRequired(id),false)
  const after=owner.planRequest(id,[user('task'),tool('read-1'),user('answer')])
  assert.equal(after.negotiationRequired,false)
  assert.match(after.hints.find(h=>h.index===2).tail,/resetScope immediately/)
  owner.clearSession(id)
})

test('SPEC[pair-hint-008] later optional negotiation does not reset an initialized scope', () => {
  const id='child-repeat'
  owner.bindDelegation(id,'parent')
  owner.planRequest(id,[user('task')])
  const first=owner.askNegotiation(id,'One question')
  assert.equal(owner.prepareNegotiationReply(first.receipt,'Answer').ok,true)
  owner.completeNegotiationReply(first.receipt)
  owner.resetSession(id,7)
  const followUp=owner.askNegotiation(id,'A follow-up')
  assert.equal(followUp.ok,true)
  assert.equal(owner.prepareNegotiationReply(followUp.receipt,'Later answer').first,false)
  assert.equal(owner.completeNegotiationReply(followUp.receipt),true)
  assert.equal(owner.negotiationRequired(id),false)
  assert.equal(owner.turnBudget(id),7)
  owner.clearSession(id)
})

test('SPEC[pair-hint-008] a previous assignment reply cannot unlock a replacement assignment', () => {
  const id='child-generation'
  owner.bindDelegation(id,'one')
  const stale=owner.askNegotiation(id,'old')
  owner.bindDelegation(id,'two')
  assert.equal(owner.prepareNegotiationReply(stale.receipt,'stale').ok,false)
  assert.equal(owner.completeNegotiationReply(stale.receipt),false)
  const current=owner.askNegotiation(id,'new')
  assert.equal(current.delegator,'two')
  assert.equal(owner.completeNegotiationReply(current.receipt),false,'a mere send receipt cannot unlock resetScope')
  assert.equal(owner.prepareNegotiationReply(current.receipt,'new answer').ok,true)
  assert.equal(owner.completeNegotiationReply(current.receipt),true)
  owner.clearSession(id)
})


test('SPEC[pair-hint-008] deleting the recipient cancels all late answer receipts', () => {
  const recipient = 'child-disposed'
  owner.bindDelegation(recipient, 'parent')
  const sent=owner.askNegotiation(recipient, 'any questions?')
  assert.equal(owner.prepareNegotiationReply(sent.receipt, 'some answer').ok,true)
  owner.clearSession(recipient)
  assert.equal(owner.completeNegotiationReply(sent.receipt),false)
  assert.equal(owner.prepareNegotiationReply(sent.receipt, 'late answer').ok,false)
  assert.equal(owner.askNegotiation(recipient, 'another').ok,false)
  owner.bindDelegation(recipient, 'new parent')
  assert.equal(owner.negotiationRequired(recipient),true)
  owner.clearSession(recipient)
})


test('SPEC[pair-hint-008] only the correct recipient’s physically visible prepared steer unlocks first negotiation', () => {
  const recipient='child-visible-reply'
  owner.bindDelegation(recipient, 'parent')
  const receipt=owner.askNegotiation(recipient, 'Where?').receipt
  assert.equal(owner.confirmNegotiationSteer(receipt,recipient),false,'sending is not the answer')
  assert.equal(owner.prepareNegotiationReply(receipt,'In parser').ok,true)
  assert.equal(owner.confirmNegotiationSteer(receipt,'another-session'),false,'the steer cannot cross session identity')
  assert.equal(owner.confirmNegotiationSteer(receipt,recipient),true)
  assert.equal(owner.negotiationRequired(recipient),false)
  assert.equal(owner.confirmNegotiationSteer(receipt,recipient),false,'one answer closes one receipt exactly once')
  owner.clearSession(recipient)
})


test('SPEC[pair-hint-008] reusing the same delegator does not demand a second mandatory negotiate', () => {
  const recipient='advisor-seat-reused'
  owner.bindDelegation(recipient, 'same-parent')
  const sent=owner.askNegotiation(recipient, 'Initial questions?')
  assert.equal(owner.prepareNegotiationReply(sent.receipt, 'Initial facts').ok, true)
  assert.equal(owner.confirmNegotiationSteer(sent.receipt, recipient), true)
  owner.resetSession(recipient, 5)
  owner.bindDelegation(recipient, 'same-parent')
  assert.equal(owner.negotiationRequired(recipient), false, 'consult follow-ups are optional negotiations')
  assert.equal(owner.turnBudget(recipient), 5, 'reuse cannot retroactively invalidate the scope')
  const follow=owner.askNegotiation(recipient, 'Optional question')
  assert.equal(follow.ok, true)
  assert.equal(owner.negotiationRequired(recipient), false)
  owner.clearSession(recipient)
})
