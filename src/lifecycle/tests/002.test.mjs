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

test('SPEC[lifecycle-002] a second consecutive unreviewed Plan relay is refused without writes', () => {
  const rig = new Rig()
  rig.open()
  rig.review(['S1 facts are not complete.'])
  assert.equal(rig.deliver().kind, 'Relayed')
  // The first unreviewed successor relay is allowed: the prior retirement was reviewed.
  assert.equal(rig.deliver().kind, 'Relayed')
  // The second consecutive unreviewed relay is the no-op chain. Refused, zero append, tenure stays.
  const successor = rig.work.inspect().active.id
  const writes = rig.count
  assert.equal(rig.call(rig.delivery()).result.kind, 'ReviewRequired')
  assert.equal(rig.count, writes)
  assert.equal(rig.work.inspect().active.id, successor)
  // A review opens the handoff again at the same stage; the chain length resets.
  rig.review(['Still incomplete.'])
  assert.equal(rig.deliver().kind, 'Relayed')
  const next = rig.work.inspect().active.id
  assert.notEqual(next, successor)
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

test('SPEC[lifecycle-002] a reused one-shot retirement fence under another provider is a retirement replay conflict', () => {
  const rig = new Rig()
  rig.open()
  const command = rig.delivery({ toolCallId: 'relay-call' })
  const relayed = rig.apply(command)
  assert.equal(relayed.kind, 'Relayed')
  const count = rig.count
  // The recorded retirement owns this call: another provider run cannot reuse it,
  // and the refusal is the retirement conflict, not the confirmation one.
  assert.throws(
    () => rig.call({ ...command, providerRunId: 'other-run' }),
    (error) => !/RetirementConfirmationReplayConflict/.test(error.message) && /RetirementReplayConflict/.test(error.message),
  )
  assert.equal(rig.count, count)
  // The recorded fence itself still replays its own result with zero writes.
  assert.equal(rig.call(command, 'retirement-fence-replay').result.retirementId, relayed.retirementId)
  assert.equal(rig.count, count)
})

test('SPEC[lifecycle-002] a reused delivery-operation fence under another provider is a retirement replay conflict', () => {
  const rig = new Rig()
  const { command } = rig.reserve()
  const count = rig.count
  assert.throws(
    () => rig.call({ ...command, providerRunId: 'other-run' }),
    (error) => !/RetirementConfirmationReplayConflict/.test(error.message) && /RetirementReplayConflict/.test(error.message),
  )
  assert.equal(rig.count, count)
  assert.equal(rig.call(command, 'delivery-fence-replay').result.kind, 'ObserveExecution')
  assert.equal(rig.count, count)
})
