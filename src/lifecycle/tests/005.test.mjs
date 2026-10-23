import test from 'node:test'
import assert from 'node:assert/strict'
import { Work } from 'wanxiangli/work'
import { Rig } from './support.mjs'

test('SPEC[lifecycle-005] a new reservation is a domain fact, not a durable dispatch permit', () => {
  const rig = new Rig()
  const { command, reply, operationId } = rig.reserve()
  assert.equal(reply.status, 'Applied')
  assert.equal(reply.result.kind, 'DeliveryRequested')
  const state = rig.work.inspect()
  assert.equal(state.pendingDelivery.operationId, operationId)
  assert.equal(state.pendingDelivery.execSessionId, null)
  assert.equal(state.canWriteSource, false)
  assert.ok(state.active)
  assert.equal(rig.work.history().at(-1).events[0].type, 'DeliveryRequested')
  assert.equal(rig.call(command, 'reserve').result.kind, 'ObserveExecution')
  assert.equal(rig.call(command, 'same-fence-another-request').result.kind, 'ObserveExecution')
  const restored = new Work('work-a', rig.work.records())
  assert.equal(restored.recover().next, 'ObserveExecution')
  assert.equal(restored.execute('reserve', command).result.kind, 'ObserveExecution')
})

test('SPEC[lifecycle-005] an unknown execution remains pending and produces no new fact', () => {
  const rig = new Rig()
  const { operationId } = rig.reserve()
  const count = rig.count
  const reply = rig.call({ type: 'ResolveDelivery', operationId, outcome: 'Unknown' })
  assert.equal(reply.status, 'Observed')
  assert.equal(reply.result.kind, 'ObserveExecution')
  assert.equal(rig.count, count)
  assert.throws(() => rig.deliver({ draft: { digest: 'another', path: '/new' } }), /pending/)
})

test('SPEC[lifecycle-005] the physical session identity is committed before prompt acceptance and survives recovery', () => {
  const rig = new Rig()
  const { command, operationId } = rig.reserve()
  const bound = rig.bindSession(operationId, 'execution-session-42')
  assert.equal(bound.kind, 'ExecutionSessionBound')
  assert.equal(bound.execSessionId, 'execution-session-42')
  assert.equal(rig.work.inspect().pendingDelivery.execSessionId, 'execution-session-42')
  const restored = new Work('work-a', rig.work.records())
  assert.equal(restored.recover().next, 'ObserveExecution')
  assert.equal(restored.inspect().pendingDelivery.execSessionId, 'execution-session-42')
  assert.equal(restored.execute('reserve', command).result.execSessionId, 'execution-session-42')
  assert.throws(
    () => rig.call({ type: 'ResolveDelivery', operationId, outcome: 'SessionCreated', execSessionId: 'other-session' }),
    /session mismatch/i,
  )
})

test('SPEC[lifecycle-005] an accepted receipt must identify the reserved operation and draft', () => {
  const rig = new Rig()
  const { operationId } = rig.reserve()
  const count = rig.count
  assert.throws(() => rig.call(rig.accepted('different-operation')), /mismatch/)
  assert.throws(() => rig.call(rig.accepted(operationId)), /durably bound/)
  const bound = rig.bindSession(operationId)
  assert.equal(bound.kind, 'ExecutionSessionBound')
  assert.equal(rig.work.inspect().pendingDelivery.execSessionId, 'execution-session')
  assert.throws(() => rig.call(rig.accepted(operationId, { digest: 'changed' })), /mismatch/)
  assert.equal(rig.count, count + 1)
  const delivered = rig.apply(rig.accepted(operationId), 'accepted')
  assert.equal(delivered.kind, 'Delivered')
  assert.equal(rig.work.inspect().active, null)
  assert.equal(rig.work.recover().next, 'Done')
  assert.equal(rig.work.history().at(-1).events[0].execSessionId, 'execution-session')
  assert.equal(rig.call(rig.accepted(operationId), 'accepted').status, 'Replayed')
})

test('SPEC[lifecycle-005] pending execution does not bypass live-resource retirement blockers', () => {
  const rig = new Rig()
  const { operationId } = rig.reserve()
  rig.bindSession(operationId)
  assert.equal(rig.apply(rig.accepted(operationId, { blockers: ['live-owned-process'] })).kind, 'Blocked')
  assert.equal(rig.work.inspect().pendingDelivery.operationId, operationId)
  assert.ok(rig.work.inspect().active)
  assert.equal(rig.apply(rig.accepted(operationId)).kind, 'Delivered')
})

test('SPEC[lifecycle-005] a known not-started result unlocks only an explicit new attempt', () => {
  const rig = new Rig()
  const { command, operationId } = rig.reserve()
  const rejected = rig.apply({ type: 'ResolveDelivery', operationId, outcome: 'NotStarted', reason: 'The host rejected before starting.' })
  assert.equal(rejected.kind, 'ExecutionRejected')
  assert.equal(rig.work.inspect().pendingDelivery, null)
  assert.equal(rig.call(command, 'reserve').result.kind, 'ExecutionRejected')
  const next = rig.deliver({ draft: { digest: 'draft-digest', path: '/plans/approved.md' } })
  assert.equal(next.kind, 'DeliveryRequested')
  assert.notEqual(next.operationId, operationId)
})

test('SPEC[lifecycle-005] a late accepted receipt is idempotent and cannot settle a later delivery', () => {
  const rig = new Rig()
  const { operationId } = rig.reserve()
  rig.bindSession(operationId)
  const retired = rig.apply(rig.accepted(operationId))
  const cursor = rig.work.history().at(-1).events[0].retirementCursor
  rig.apply({ type: 'Reopen', retirementId: retired.retirementId, ownerId: 'manager', openingCursor: cursor + 1, blockers: [] })
  rig.review()
  // Deliver authorizes the reopened S3 tenure first, then a drafted deliver reserves.
  assert.equal(rig.deliver().kind, 'Authorized')
  const next = rig.deliver({ draft: { digest: 'next-draft', path: '/next-plan' } })
  const count = rig.count
  assert.equal(rig.call(rig.accepted(operationId), 'late-accepted').result.retirementId, retired.retirementId)
  assert.equal(rig.work.inspect().pendingDelivery.operationId, next.operationId)
  assert.equal(rig.count, count)
  assert.throws(() => rig.call(rig.accepted(operationId, { execSessionId: 'different-session' })), /conflict|mismatch/i)
})
