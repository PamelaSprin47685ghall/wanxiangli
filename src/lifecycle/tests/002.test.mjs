import test from 'node:test'
import assert from 'node:assert/strict'
import { Rig } from './support.mjs'

test('SPEC[lifecycle-002] Plan advances through S1 S2 S3 without two-call confirmation', () => {
  const rig = new Rig()
  rig.authorizePlan()
  assert.equal(rig.work.inspect().stage, 'S3')
  // Each promotion relays into a fresh tenure, so two promotion rounds retire.
  assert.equal(rig.work.inspect().rounds.length, 2)
  assert.equal(rig.eventTypes().includes('ConfirmationCommitted'), false)
})

test('SPEC[lifecycle-002] a stayed Plan review does not advance or authorize delivery', () => {
  const rig = new Rig()
  rig.open()
  rig.review([{ key: 'consumer-test', value: 'The migration has no consumer test.' }])
  assert.equal(rig.work.inspect().stage, 'S1')
  assert.equal(rig.work.inspect().deliveryAuthorized, false)
  // A non-empty ledger blocks delivery until the obligation is cleared.
  assert.equal(rig.call(rig.delivery(), 'blocked-attempt').result.kind, 'Blocked')
  rig.review([{ key: 'consumer-test', value: null }])
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

test('SPEC[lifecycle-002] consecutive unreviewed Plan relays succeed because review is never a lifecycle precondition', () => {
  const rig = new Rig()
  rig.open()
  // Multiple consecutive relays without review succeed; review is an optional
  // collaboration result, not a lifecycle precondition for hand-off.
  assert.equal(rig.deliver().kind, 'Relayed')
  assert.equal(rig.deliver().kind, 'Relayed')
  assert.equal(rig.deliver().kind, 'Relayed')
  assert.equal(rig.work.inspect().stage, 'S1')
  assert.equal(rig.work.inspect().rounds.length, 3)
})

test('SPEC[lifecycle-002] S4 single delivery completes without confirmation ritual or review precondition', () => {
  const rig = new Rig(['S4'])
  rig.open()
  // An unreviewed S4 is not eligible, so it relays to a successor.
  const unreviewedRig = new Rig(['S4'])
  unreviewedRig.open()
  const unreviewedDelivery = unreviewedRig.delivery({ toolCallId: 'unreviewed-relay', nextOwnerId: 'manager' })
  assert.equal(unreviewedRig.apply(unreviewedDelivery).kind, 'Relayed')
  assert.notEqual(unreviewedRig.work.inspect().active, null)

  // A reviewed (empty ledger) S4 is eligible and completes in one call.
  rig.review()
  assert.equal(rig.work.inspect().deliveryAuthorized, false)
  assert.equal(rig.deliver({ toolCallId: 'retirement' }).kind, 'Delivered')
  assert.equal(rig.work.inspect().active, null)
  assert.equal(rig.work.recover().next, 'Done')
  const retired = rig.work.history().at(-1).events[0]
  assert.deepEqual(retired.projectionCut, { providerRunId: 'run-1', toolCallId: 'retirement' })
  for (const key of ['retirementCursor', 'execSessionId', 'digest', 'path']) assert.equal(key in retired, false)
})

test('SPEC[lifecycle-002] a stayed S4 review relays with auto-dispatch in a single delivery', () => {
  const rig = new Rig(['S4'])
  rig.open()
  rig.review([{ key: 'incomplete', value: 'Still incomplete.' }])
  // The stayed ledger blocks delivery; a later review clears the obligation and
  // the eligibility stays locked as Stayed, so deliver relays a successor.
  rig.review([{ key: 'incomplete', value: null }])
  const result = rig.deliver({ cursor: 70 })
  assert.equal(result.kind, 'Relayed')
  assert.equal(result.autoDispatch, true)
  assert.equal(rig.work.inspect().active.openingCursor, 70)
  assert.equal(rig.work.inspect().active.reviewOutcome, null)
})

test('SPEC[lifecycle-002] MUST-KEEP: a retired tenure cannot close the new one', () => {
  const rig = new Rig(['S4'])
  const first = rig.open()
  rig.review([{ key: 'rework', value: 'First pass needs rework.' }])
  rig.review([{ key: 'rework', value: null }])
  // First tenure relays to a successor tenure.
  const relay = rig.deliver({ cursor: 10, nextOwnerId: 'manager' })
  const secondTenureId = rig.work.inspect().active.id
  assert.notEqual(secondTenureId, first.incumbencyId)

  // The retired first tenure attempts to issue a delivery targeting the work.
  // The kernel refuses because incumbencyId does not match the active tenure.
  const staleDelivery = rig.delivery({
    incumbencyId: first.incumbencyId,
    toolCallId: 'stale-retire-attempt',
    nextOwnerId: undefined,
  })
  assert.throws(() => rig.call(staleDelivery), /mismatch/i)
  // Active tenure is unchanged; nothing retired.
  assert.equal(rig.work.inspect().active.id, secondTenureId)
})

test('SPEC[lifecycle-002] MUST-KEEP: one active owner per work and active resource honestly blocks completion', () => {
  const rig = new Rig(['S4'])
  const first = rig.open({ ownerId: 'owner-a' })
  assert.equal(rig.work.inspect().active.ownerId, 'owner-a')

  // Active resource (blocker) cannot be reported as retired/completed.
  rig.review([])
  const blocked = rig.deliver({ blockers: ['live-process-1', 'live-port-2'], nextOwnerId: undefined })
  assert.equal(blocked.kind, 'Blocked')
  // Tenure is still active and unchanged.
  assert.equal(rig.work.inspect().active.id, first.incumbencyId)
  assert.equal(rig.work.inspect().active.ownerId, 'owner-a')

  // Once settled (no blockers), the single delivery intent genuinely completes.
  const completed = rig.deliver({ blockers: [], nextOwnerId: undefined })
  assert.equal(completed.kind, 'Delivered')
  assert.equal(rig.work.inspect().active, null)
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
