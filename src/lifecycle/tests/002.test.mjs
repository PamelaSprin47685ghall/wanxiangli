import test from 'node:test'
import assert from 'node:assert/strict'
import { Rig } from './support.mjs'

test('SPEC[lifecycle-002] Plan advances through S1 S2 S3 without two-call confirmation', () => {
  const rig = new Rig()
  rig.authorizePlan()
  assert.equal(rig.work.inspect().stage, 'S3')
  assert.equal(rig.work.inspect().rounds.length, 2)
  assert.equal(rig.eventTypes().includes('ConfirmationCommitted'), false)
  assert.deepEqual(rig.work.inspect().rounds.map(round => [round.openingStage, round.closingStage]), [['S1', 'S2'], ['S2', 'S3']])
})

test('SPEC[lifecycle-002] a stayed Plan review does not advance or authorize delivery', () => {
  const rig = new Rig()
  rig.open()
  rig.review(['The migration has no consumer test.'])
  assert.equal(rig.work.inspect().stage, 'S1')
  assert.equal(rig.work.inspect().deliveryAuthorized, false)
  assert.equal(rig.deliver().kind, 'Relayed')
  assert.equal(rig.work.inspect().active.openingStage, 'S1')
})

test('SPEC[lifecycle-002] an unreviewed Plan can relay but cannot write source', () => {
  const rig = new Rig()
  rig.open()
  assert.equal(rig.work.inspect().canWriteSource, false)
  assert.equal(rig.deliver().kind, 'Relayed')
  assert.equal(rig.work.inspect().stage, 'S1')
})

test('SPEC[lifecycle-002] S4 requires review and two different delivery calls', () => {
  const rig = new Rig(['S4'])
  rig.open()
  assert.equal(rig.call(rig.delivery()).result.kind, 'ReviewRequired')
  assert.equal(rig.count, 1)
  rig.review()
  assert.equal(rig.work.inspect().deliveryAuthorized, false)
  const first = rig.delivery({ toolCallId: 'confirmation' })
  assert.equal(rig.apply(first).kind, 'Confirmed')
  const writes = rig.count
  assert.equal(rig.call(first, 'confirmation-again').result.kind, 'Confirmed')
  assert.equal(rig.count, writes)
  assert.ok(rig.work.inspect().active)
  assert.equal(rig.deliver({ toolCallId: 'retirement' }).kind, 'Delivered')
  assert.equal(rig.work.inspect().active, null)
  assert.equal(rig.work.recover().next, 'Done')
  const retired = rig.work.history().at(-1).events[0]
  assert.deepEqual(retired.projectionCut, { providerRunId: 'run-1', toolCallId: 'retirement' })
  for (const key of ['retirementCursor', 'execSessionId', 'digest', 'path']) assert.equal(key in retired, false)
})

test('SPEC[lifecycle-002] a stayed S4 review confirms and relays with auto-dispatch', () => {
  const rig = new Rig(['S4'])
  rig.open()
  rig.review(['Still incomplete.'])
  rig.deliver()
  const result = rig.deliver({ cursor: 70 })
  assert.equal(result.kind, 'Relayed')
  assert.equal(result.autoDispatch, true)
  assert.equal(rig.work.inspect().active.openingCursor, 70)
  assert.equal(rig.work.inspect().active.reviewOutcome, null)
})

test('SPEC[lifecycle-002] a reused tool call under another provider is not a second confirmation', () => {
  const rig = new Rig(['S4'])
  rig.open()
  rig.review()
  const command = rig.delivery({ toolCallId: 'same-call' })
  rig.apply(command)
  const count = rig.count
  assert.throws(() => rig.call({ ...command, providerRunId: 'other-run' }), /RetirementConfirmationReplayConflict/)
  assert.equal(rig.count, count)
})
