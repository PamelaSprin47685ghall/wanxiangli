import test from 'node:test'
import assert from 'node:assert/strict'
import { Rig, binding, started, ended, unchanged } from './support.mjs'

test('SPEC[ownership-002] unknown and cancellation leave reservations unresolved', () => {
  const rig = new Rig()
  rig.open()
  const lease = rig.reserve()
  const before = rig.owner.records()
  assert.equal(rig.call({ type: 'Unknown', lease }).status, 'Observed')
  assert.deepEqual(rig.owner.records(), before)
  rig.apply({ type: 'Cancel', lease })
  assert.equal(rig.owner.resource(lease).phase, 'Reserved')
  assert.equal(rig.owner.resource(lease).cancellationRequested, true)
  assert.equal(rig.owner.blockers('work').length, 1)
})

test('SPEC[ownership-002] started, cancellation and terminal are different observations', () => {
  const rig = new Rig()
  rig.open()
  const lease = rig.reserve()
  rig.apply(started(lease))
  rig.apply({ type: 'Cancel', lease })
  assert.equal(rig.owner.resource(lease).phase, 'Running')
  unchanged(rig.owner, () => rig.call({ type: 'NotStarted', lease, reason: 'No reply.' }), /started/)
  rig.apply(ended(lease, binding(), 'Cancelled'))
  assert.equal(rig.owner.resource(lease).phase, 'Ended')
  assert.equal(rig.owner.resource(lease).outcome, 'Cancelled')
  assert.equal(rig.owner.blockers('work').length, 0)
})

test('SPEC[ownership-002] a lost start acknowledgement can be reconciled by an exact terminal witness', () => {
  const rig = new Rig()
  rig.open()
  const lease = rig.reserve()
  rig.apply(ended(lease, binding('pid', 'launch-instance'), 'Failed'))
  assert.equal(rig.owner.resource(lease).outcome, 'Failed')
  assert.equal(rig.call(started(lease, binding('pid', 'launch-instance'))).status, 'Observed')
  unchanged(rig.owner, () => rig.call(ended(lease, binding('pid', 'other-instance'), 'Failed')), /conflict/)
})

test('SPEC[ownership-002] a final not-started observation is idempotent but cannot become a start later', () => {
  const rig = new Rig()
  rig.open()
  const lease = rig.reserve()
  const rejected = { type: 'NotStarted', lease, reason: 'Creation permanently refused.' }
  rig.apply(rejected)
  assert.equal(rig.call(rejected).status, 'Observed')
  unchanged(rig.owner, () => rig.call({ ...rejected, reason: 'different' }), /conflict/)
  unchanged(rig.owner, () => rig.call(started(lease)), /not started/)
  unchanged(rig.owner, () => rig.call(ended(lease)), /conflict/)
})

test('SPEC[ownership-002] one physical container cannot be concurrently claimed by two live leases', () => {
  const rig = new Rig()
  rig.open()
  const first = rig.reserve('first')
  const second = rig.reserve('second')
  rig.apply(started(first, binding('pid', 'one')))
  unchanged(rig.owner, () => rig.call(started(second, binding('pid', 'two'))), /active/)
  assert.equal(rig.owner.resource(second).phase, 'Reserved')
  rig.apply(ended(first, binding('pid', 'one')))
  unchanged(rig.owner, () => rig.call(started(second, binding('pid', 'one'))), /incarnation/)
  rig.apply(started(second, binding('pid', 'two')))
  assert.equal(rig.owner.resource(second).phase, 'Running')
})

test('SPEC[ownership-002] a late terminal for an old container incarnation cannot release the new lease', () => {
  const rig = new Rig()
  rig.open()
  const first = rig.reserve('first')
  rig.apply(started(first, binding('reused', 'one')))
  rig.apply(ended(first, binding('reused', 'one')))
  const second = rig.reserve('second')
  rig.apply(started(second, binding('reused', 'two')))
  assert.equal(rig.call(ended(first, binding('reused', 'one'))).status, 'Observed')
  unchanged(rig.owner, () => rig.call(ended(second, binding('reused', 'one'))), /binding/)
  assert.deepEqual(rig.owner.blockers('work').map(value => value.lease), [second])
})

test('SPEC[ownership-002] reconciling an unacknowledged old instance does not delete a newer active binding', () => {
  const rig = new Rig()
  rig.open()
  const old = rig.reserve('old')
  const current = rig.reserve('current')
  rig.apply(started(current, binding('container', 'current-instance')))
  rig.apply(ended(old, binding('container', 'old-instance')))
  const next = rig.reserve('next')
  unchanged(rig.owner, () => rig.call(started(next, binding('container', 'next-instance'))), /active/)
  assert.deepEqual(rig.owner.blockers('work').map(value => value.lease), [current, next])
})

test('SPEC[ownership-002] kinds have separate physical namespaces and terminal conflicts never overwrite evidence', () => {
  const rig = new Rig()
  rig.open()
  const process = rig.reserve('process', 'work', 'process')
  const session = rig.reserve('session', 'work', 'session')
  rig.apply(started(process))
  rig.apply(started(session))
  rig.apply(ended(process))
  unchanged(rig.owner, () => rig.call(ended(process, binding(), 'Failed')), /conflict/)
  assert.equal(rig.owner.resource(process).outcome, 'Completed')
  assert.equal(rig.owner.resource(session).phase, 'Running')
})
