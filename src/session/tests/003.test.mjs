import test from 'node:test'
import assert from 'node:assert/strict'
import { Rig, open, reserve, binding, started, ended, unchanged } from './support.mjs'

test('SPEC[ownership-003] drain closes all descendant admission but leaves every unresolved resource owned', () => {
  const rig = new Rig()
  rig.open()
  rig.open('child', 'work')
  rig.open('grandchild', 'child')
  const first = rig.reserve('first', 'work')
  const second = rig.reserve('second', 'grandchild')
  rig.apply(started(second))
  const before = rig.owner.blockers('work').map(value => value.lease)
  rig.apply({ type: 'Drain', scopeId: 'work' })
  for (const id of ['work', 'child', 'grandchild']) {
    assert.equal(rig.owner.scope(id).phase, 'Draining')
    unchanged(rig.owner, () => rig.call(open(`new-${id}`, id)), /admission/)
    unchanged(rig.owner, () => rig.call(reserve(`new-${id}`, id)), /admission/)
  }
  assert.deepEqual(rig.owner.blockers('work').map(value => value.lease), before)
  assert.ok(rig.owner.blockers('work').every(value => value.cancellationRequested))
  assert.equal(rig.owner.resource(first).phase, 'Reserved')
  assert.equal(rig.owner.resource(second).phase, 'Running')
})

test('SPEC[ownership-003] a late start after drain remains accountable until actual end', () => {
  const rig = new Rig()
  rig.open()
  const lease = rig.reserve()
  rig.apply({ type: 'Drain', scopeId: 'work' })
  rig.apply(started(lease))
  assert.equal(rig.owner.resource(lease).cancellationRequested, true)
  unchanged(rig.owner, () => rig.apply({ type: 'Close', scopeId: 'work' }), /unsettled/)
  rig.apply(ended(lease))
  rig.apply({ type: 'Close', scopeId: 'work' })
  assert.equal(rig.owner.scope('work').phase, 'Closed')
})

test('SPEC[ownership-003] failed close does not partially close empty siblings or the parent', () => {
  const rig = new Rig()
  rig.open()
  rig.open('empty', 'work')
  rig.open('busy', 'work')
  rig.reserve('pending', 'busy')
  const states = ['work', 'empty', 'busy'].map(id => rig.owner.scope(id))
  unchanged(rig.owner, () => rig.call({ type: 'Close', scopeId: 'work' }), /unsettled/)
  assert.deepEqual(['work', 'empty', 'busy'].map(id => rig.owner.scope(id)), states)
  rig.reserve('still-admitted', 'empty')
})

test('SPEC[ownership-003] close atomically seals an empty subtree without requiring manual child close steps', () => {
  const rig = new Rig()
  rig.open()
  rig.open('child', 'work')
  rig.open('leaf', 'child')
  const before = rig.owner.head().revision
  rig.apply({ type: 'Close', scopeId: 'work' })
  assert.equal(rig.owner.head().revision, before + 1)
  for (const id of ['work', 'child', 'leaf']) assert.equal(rig.owner.scope(id).phase, 'Closed')
  assert.equal(rig.call({ type: 'Close', scopeId: 'work' }).status, 'Observed')
  unchanged(rig.owner, () => rig.open('another', 'leaf'), /admission/)
})

test('SPEC[ownership-003] a child tenure can close while its long-lived parent still owns DevOps', () => {
  const rig = new Rig()
  rig.open()
  const devops = rig.reserve('fixed-devops', 'work', 'session')
  rig.open('first-tenure', 'work')
  const process = rig.reserve('tool-process', 'first-tenure')
  rig.apply(started(devops, binding('devops', 'stable-worker')))
  rig.apply({ type: 'NotStarted', lease: process, reason: 'No launch occurred.' })
  rig.apply({ type: 'Drain', scopeId: 'first-tenure' })
  rig.apply({ type: 'Close', scopeId: 'first-tenure' })
  assert.deepEqual(rig.owner.blockers('first-tenure'), [])
  assert.deepEqual(rig.owner.blockers('work').map(value => value.lease), [devops])
  assert.equal(rig.owner.resource(devops).cancellationRequested, false)
  rig.open('second-tenure', 'work')
  assert.equal(rig.owner.resource(devops).phase, 'Running')
})

test('SPEC[ownership-003] child drain does not close siblings or their admission', () => {
  const rig = new Rig()
  rig.open()
  rig.open('a', 'work')
  rig.open('b', 'work')
  const a = rig.reserve('a', 'a')
  const b = rig.reserve('b', 'b')
  rig.apply({ type: 'Drain', scopeId: 'a' })
  assert.equal(rig.owner.resource(a).cancellationRequested, true)
  assert.equal(rig.owner.resource(b).cancellationRequested, false)
  rig.reserve('still-open', 'b')
  assert.equal(rig.owner.scope('work').phase, 'Open')
})

test('SPEC[ownership-003] cancellation and repeated drain never decrement another lease', () => {
  const rig = new Rig()
  rig.open()
  const first = rig.reserve('first')
  const second = rig.reserve('second')
  rig.apply({ type: 'Cancel', lease: first })
  assert.equal(rig.call({ type: 'Cancel', lease: first }).status, 'Observed')
  assert.equal(rig.owner.resource(second).cancellationRequested, false)
  rig.apply({ type: 'Drain', scopeId: 'work' })
  const count = rig.owner.records().length
  for (let index = 0; index < 10; index++) rig.call({ type: 'Drain', scopeId: 'work' })
  assert.equal(rig.owner.records().length, count)
  assert.equal(rig.owner.inspect().unsettled, 2)
})

test('SPEC[ownership-003] cancelling a settled resource and draining a closed scope report the existing terminal state', () => {
  const rig = new Rig()
  rig.open()
  const lease = rig.reserve()
  rig.apply({ type: 'NotStarted', lease, reason: 'No physical work.' })
  const before = rig.owner.records()
  const cancelled = rig.call({ type: 'Cancel', lease })
  assert.equal(cancelled.status, 'Observed')
  assert.equal(cancelled.result.kind, 'Settled')
  assert.equal(rig.owner.resource(lease).cancellationRequested, false)
  assert.deepEqual(rig.owner.records(), before)
  rig.apply({ type: 'Close', scopeId: 'work' })
  const drained = rig.call({ type: 'Drain', scopeId: 'work' })
  assert.equal(drained.status, 'Observed')
  assert.equal(drained.result.kind, 'Closed')
})

test('SPEC[ownership-003] deep ownership uses iterative traversal rather than recursive cleanup', () => {
  const rig = new Rig()
  rig.open('root')
  let parent = 'root'
  for (let index = 0; index < 1500; index++) {
    const child = `scope-${index}`
    rig.open(child, parent)
    parent = child
  }
  const lease = rig.reserve('bottom', parent)
  assert.equal(rig.owner.blockers('root').length, 1)
  rig.apply({ type: 'Drain', scopeId: 'root' })
  assert.equal(rig.owner.resource(lease).cancellationRequested, true)
  rig.apply({ type: 'NotStarted', lease, reason: 'Never dispatched.' })
  rig.apply({ type: 'Close', scopeId: 'root' })
  assert.equal(rig.owner.scope(parent).phase, 'Closed')
})
