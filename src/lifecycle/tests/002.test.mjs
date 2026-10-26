import test from 'node:test'
import assert from 'node:assert/strict'
import { Rig } from './support.mjs'

test('SPEC[lifecycle-002] three empty originator reviews ask three times and keep the tenure', () => {
  const rig = new Rig()
  const ids = []
  for (let index = 0; index < 3; index += 1) {
    const asked = rig.review([])
    assert.equal(asked.kind, 'Asked')
    ids.push(asked.incumbencyId)
    const names = rig.work.history().at(-1).events.map(event => event.type)
    assert.equal(names.includes('Reviewed'), false)
    assert.equal(names.includes('IncumbencyRetired'), false)
    const pending = rig.call({ type: 'Review', office: 'Plan', providerRunId: 'run-1', toolCallId: `early-${index}`, updates: [] })
    assert.equal(pending.status, 'Conflict')
    assert.equal(pending.reason, 'Effect pending')
    rig.confirm(asked.effect, 'Parked')
    assert.equal(rig.work.recover().wait, 'AwaitOperatorAnswer')
    const beforeAnswer = rig.call({ type: 'Review', office: 'Plan', providerRunId: 'run-1', toolCallId: `during-${index}`, updates: [] })
    assert.equal(beforeAnswer.reason, 'Awaiting operator answer')
    rig.answer(`reply-${index}`)
    assert.equal(rig.work.inspect().active.id, ids[0])
  }
  assert.equal(new Set(ids).size, 1)
  assert.equal(rig.work.history().flatMap(frame => frame.events).filter(event => event.type === 'Reviewed').length, 0)
  const reviewed = rig.review([{ key: 'need', value: 'a plan' }])
  assert.equal(reviewed.kind, 'Reviewed')
  assert.equal(reviewed.incumbencyId, ids[0])
})

test('SPEC[lifecycle-002] clearing the ledger relays and the successor first empty review advances', () => {
  const rig = new Rig()
  rig.review([{ key: 'need', value: 'a plan' }])
  const relay = rig.review([{ key: 'need', value: null }])
  assert.equal(relay.kind, 'Relayed')
  assert.equal(relay.effect.kind, 'Dispatch')
  rig.send(relay)
  const advanced = rig.review([])
  assert.equal(advanced.kind, 'Advanced')
  assert.notEqual(advanced.kind, 'Relayed')
  assert.equal(rig.work.inspect().active.id, relay.successorId)
  assert.equal(rig.work.history().at(-1).events.some(event => event.type === 'IncumbencyOpened'), false)
  assert.equal(rig.work.history().at(-1).events.some(event => event.type === 'ContextBarrier'), false)
})

test('SPEC[lifecycle-002] a successor that first keeps a ledger relays when it later clears', () => {
  const rig = new Rig()
  rig.review([{ key: 'need', value: 'a plan' }])
  const relay = rig.review([{ key: 'need', value: null }])
  rig.send(relay)
  const kept = rig.review([{ key: 'check', value: 'open' }])
  assert.equal(kept.kind, 'Reviewed')
  assert.equal(kept.incumbencyId, relay.successorId)
  const again = rig.review([{ key: 'check', value: null }])
  assert.equal(again.kind, 'Relayed')
  assert.notEqual(again.successorId, relay.successorId)
})
