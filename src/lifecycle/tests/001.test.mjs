import test from 'node:test'
import assert from 'node:assert/strict'
import { Work } from 'wanxiangli/work'
import { Rig } from './support.mjs'

test('SPEC[lifecycle-001] opening is one transaction with one first incumbent', () => {
  const rig = new Rig()
  const opened = rig.open({ openingCursor: 41 })
  assert.equal(rig.count, 1)
  const history = rig.work.history()
  assert.equal(history.length, 1)
  assert.deepEqual(history[0].events.map(event => event.type), ['WorkOpened', 'IncumbencyOpened'])
  const state = rig.work.inspect()
  assert.equal(state.root, rig.openCommand.root)
  assert.equal(state.active.id, opened.incumbencyId)
  assert.equal(state.active.openingCursor, 41)
  assert.equal(state.stage, 'S1')
  assert.match(state.authority, /^[0-9a-f]{64}$/)
  assert.equal(state.canWriteSource, false)
})

test('SPEC[lifecycle-001] relay atomically retires the old incumbent and opens its successor', () => {
  const rig = new Rig()
  const first = rig.open()
  // An unreviewed Plan is not eligible: deliver relays to a successor at the
  // same stage (no stage advance).
  const result = rig.deliver({ cursor: 97, nextOwnerId: 'successor' })
  const frame = rig.work.history().at(-1)
  assert.deepEqual(frame.events.map(event => event.type), ['IncumbencyRetired', 'IncumbencyOpened'])
  assert.equal(frame.events[0].incumbencyId, first.incumbencyId)
  assert.equal(frame.events[0].retirementCursor, 97)
  assert.equal(frame.events[1].openingCursor, 97)
  assert.equal(frame.events[1].stage, 'S1')
  assert.equal(rig.work.inspect().active.id, result.successorId)
  assert.notEqual(result.successorId, first.incumbencyId)
  assert.equal(result.autoDispatch, false)
  assert.equal(rig.work.inspect().active.reviewOutcome, null)
})

test('SPEC[lifecycle-001] an independent object restores data without any service', () => {
  const rig = new Rig()
  rig.open()
  rig.review([{ key: 'gap', value: 'open' }])
  rig.review([{ key: 'gap', value: null }])
  rig.deliver()
  const records = rig.work.records()
  const restored = new Work('work-a', records)
  assert.deepEqual(restored.inspect(), rig.work.inspect())
  assert.deepEqual(restored.history(), rig.work.history())
  assert.equal(restored.recover().next, 'Review')
  assert.deepEqual(rig.work.records(), records)
})

test('SPEC[lifecycle-001] separate work streams never share ownership or state', () => {
  const rig = new Rig()
  rig.open()
  const other = new Work('work-b')
  other.execute('open', { ...rig.openCommand, ownerId: 'another-manager' })
  assert.notEqual(other.inspect().active.id, rig.work.inspect().active.id)
  assert.equal(other.inspect().active.ownerId, 'another-manager')
  assert.equal(rig.work.inspect().active.ownerId, 'manager')
})

test('SPEC[lifecycle-001] an unopened work can be inspected but cannot be reviewed', () => {
  const rig = new Rig()
  assert.equal(rig.work.recover().next, 'Open')
  assert.equal(rig.work.inspect().active, null)
  assert.throws(() => rig.call({ type: 'Review', incumbencyId: 'absent', reviewerId: 'reviewer', updates: [] }), /No active/)
  assert.equal(rig.count, 0)
})
