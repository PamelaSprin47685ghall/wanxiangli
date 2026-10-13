import test from 'node:test'
import assert from 'node:assert/strict'
import { Rig, open, reserve, unchanged } from './support.mjs'

test('SPEC[ownership-001] resource reservation has one owner before any start is observed', () => {
  const rig = new Rig()
  rig.open()
  rig.open('tenure', 'work')
  const lease = rig.reserve('child', 'tenure', 'session')
  assert.equal(rig.owner.resource(lease).phase, 'Reserved')
  assert.equal(rig.owner.resource(lease).binding, null)
  assert.deepEqual(rig.owner.blockers('work').map(value => value.lease), [lease])
  assert.equal(rig.owner.scope('tenure').parentId, 'work')
  assert.equal(rig.owner.head().revision, 3)
})

test('SPEC[ownership-001] missing parents, self ownership, reparenting and reusing an owner identity fail atomically', () => {
  const rig = new Rig()
  unchanged(rig.owner, () => rig.call(open('a', 'a')), /itself/)
  unchanged(rig.owner, () => rig.call(open('a', 'missing')), /exist/)
  rig.open('a')
  rig.open('b', 'a')
  unchanged(rig.owner, () => rig.call(open('a', 'b')), /conflict/)
  unchanged(rig.owner, () => rig.call(open('b', null)), /conflict/)
  assert.deepEqual(rig.owner.scope('a').children, ['b'])
})

test('SPEC[ownership-001] multiple roots and siblings are independent', () => {
  const rig = new Rig()
  rig.open('b')
  rig.open('a')
  rig.open('a-child', 'a')
  const first = rig.reserve('first', 'a-child')
  const second = rig.reserve('second', 'b')
  assert.deepEqual(rig.owner.inspect().roots, ['a', 'b'])
  assert.deepEqual(rig.owner.blockers('a').map(value => value.lease), [first])
  assert.deepEqual(rig.owner.blockers('b').map(value => value.lease), [second])
})

test('SPEC[ownership-001] same reservation cannot be stolen by another owner or reclassified', () => {
  const rig = new Rig()
  rig.open('a')
  rig.open('b')
  const lease = rig.reserve('resource', 'a', 'provider')
  unchanged(rig.owner, () => rig.call(reserve('resource', 'b', 'provider')), /conflict/)
  unchanged(rig.owner, () => rig.call(reserve('resource', 'a', 'process')), /conflict/)
  assert.deepEqual(rig.call(reserve('resource', 'a', 'provider')).result.lease, lease)
  assert.equal(rig.call(reserve('resource', 'a', 'provider')).status, 'Observed')
})

test('SPEC[ownership-001] identical calls are observed or replayed, not new launch permission', () => {
  const rig = new Rig()
  const first = rig.call(open(), 'open')
  assert.deepEqual(rig.call(open(), 'open'), { ...first, status: 'Replayed' })
  assert.equal(rig.call(open(), 'another-request').status, 'Observed')
  const reserved = rig.call(reserve(), 'reserve')
  assert.deepEqual(rig.call(reserve(), 'reserve'), { ...reserved, status: 'Replayed' })
  assert.equal(rig.call(reserve(), 'another-reserve').record, null)
  assert.equal(rig.owner.records().length, 2)
})

test('SPEC[ownership-001] resource identity remains retired and cannot be resurrected by reservation replay', () => {
  const rig = new Rig()
  rig.open()
  const lease = rig.reserve()
  rig.apply({ type: 'NotStarted', lease, reason: 'Admission refused.' })
  rig.apply({ type: 'Close', scopeId: 'work' })
  assert.equal(rig.call(reserve()).status, 'Observed')
  assert.equal(rig.owner.resource(lease).phase, 'NotStarted')
  unchanged(rig.owner, () => rig.reserve('new'), /admission/)
  unchanged(rig.owner, () => rig.open('child', 'work'), /admission/)
  assert.equal(rig.owner.scope('work').phase, 'Closed')
})

test('SPEC[ownership-001] identifier delimiters and prototype-looking names remain ordinary data', () => {
  const rig = new Rig('__proto__')
  rig.open('__proto__')
  rig.open('constructor')
  const first = rig.reserve('a/b', '__proto__', 'tool')
  const second = rig.reserve('a', 'constructor', 'tool')
  assert.notEqual(first.token, second.token)
  assert.equal(rig.owner.blockers('__proto__')[0].lease.resourceId, 'a/b')
})
