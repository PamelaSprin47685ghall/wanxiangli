import test from 'node:test'
import assert from 'node:assert/strict'
import { Work } from 'wanxiangli/work'
import { Rig } from './support.mjs'

test('SPEC[lifecycle-005] only a newly committed reservation permits external dispatch', () => {
  const rig = new Rig()
  const { command, reply, operationId } = rig.reserve()
  assert.equal(reply.result.kind, 'DispatchExecution')
  const state = rig.work.inspect()
  assert.equal(state.pendingDelivery.operationId, operationId)
  assert.equal(state.canWriteSource, false)
  assert.ok(state.active)
  assert.equal(rig.work.history().at(-1).events[0].type, 'DeliveryRequested')
  assert.equal(rig.call(command, 'reserve').result.kind, 'ObserveExecution')
  assert.equal(rig.call(command, 'same-fence-another-request').result.kind, 'ObserveExecution')
  const restored = new Work('work-a', rig.journal)
  assert.equal(restored.recover().next, 'ObserveExecution')
  assert.equal(restored.execute('reserve', command).result.kind, 'ObserveExecution')
})

test('SPEC[lifecycle-005] an unknown execution remains pending and produces no new fact', () => {
  const rig = new Rig()
  const { operationId } = rig.reserve()
  const count = rig.journal.calls
  const reply = rig.call({ type: 'ResolveDelivery', operationId, outcome: 'Unknown' })
  assert.equal(reply.status, 'Observed')
  assert.equal(reply.result.kind, 'ObserveExecution')
  assert.equal(rig.journal.calls, count)
  assert.throws(() => rig.deliver({ draft: { digest: 'another', path: '/new' } }), /pending/)
})

test('SPEC[lifecycle-005] an accepted receipt must identify the reserved operation and draft', () => {
  const rig = new Rig()
  const { operationId } = rig.reserve()
  const count = rig.journal.calls
  assert.throws(() => rig.call(rig.accepted('different-operation')), /mismatch/)
  assert.throws(() => rig.call(rig.accepted(operationId, { digest: 'changed' })), /mismatch/)
  assert.equal(rig.journal.calls, count)
  const delivered = rig.commit(rig.accepted(operationId), 'accepted')
  assert.equal(delivered.kind, 'Delivered')
  assert.equal(rig.work.inspect().active, null)
  assert.equal(rig.work.recover().next, 'Done')
  assert.equal(rig.work.history().at(-1).events[0].execSessionId, 'execution-session')
  assert.equal(rig.call(rig.accepted(operationId), 'accepted').status, 'Replayed')
})

test('SPEC[lifecycle-005] pending execution does not bypass live-resource retirement blockers', () => {
  const rig = new Rig()
  const { operationId } = rig.reserve()
  assert.equal(rig.commit(rig.accepted(operationId, { blockers: ['live-owned-process'] })).kind, 'Blocked')
  assert.equal(rig.work.inspect().pendingDelivery.operationId, operationId)
  assert.ok(rig.work.inspect().active)
  assert.equal(rig.commit(rig.accepted(operationId)).kind, 'Delivered')
})

test('SPEC[lifecycle-005] a known not-started result unlocks only an explicit new attempt', () => {
  const rig = new Rig()
  const { command, operationId } = rig.reserve()
  const rejected = rig.commit({ type: 'ResolveDelivery', operationId, outcome: 'NotStarted', reason: 'The host rejected before starting.' })
  assert.equal(rejected.kind, 'ExecutionRejected')
  assert.equal(rig.work.inspect().pendingDelivery, null)
  assert.equal(rig.call(command, 'reserve').result.kind, 'ExecutionRejected')
  const next = rig.deliver({ draft: { digest: 'draft-digest', path: '/plans/approved.md' } })
  assert.equal(next.kind, 'DispatchExecution')
  assert.notEqual(next.operationId, operationId)
})

test('SPEC[lifecycle-005] a late accepted receipt is idempotent and cannot settle a later delivery', () => {
  const rig = new Rig()
  const { operationId } = rig.reserve()
  const retired = rig.commit(rig.accepted(operationId))
  const cursor = rig.work.history().at(-1).events[0].retirementCursor
  rig.commit({ type: 'Reopen', retirementId: retired.retirementId, ownerId: 'manager', openingCursor: cursor + 1, blockers: [] })
  rig.review()
  const next = rig.deliver({ draft: { digest: 'next-draft', path: '/next-plan' } })
  const count = rig.journal.calls
  assert.equal(rig.call(rig.accepted(operationId), 'late-accepted').result.retirementId, retired.retirementId)
  assert.equal(rig.work.inspect().pendingDelivery.operationId, next.operationId)
  assert.equal(rig.journal.calls, count)
  assert.throws(() => rig.call(rig.accepted(operationId, { execSessionId: 'different-session' })), /conflict|mismatch/i)
})
