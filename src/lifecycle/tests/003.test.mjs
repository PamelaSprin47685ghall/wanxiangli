import test from 'node:test'
import assert from 'node:assert/strict'
import { Work } from 'wanxiangli/work'
import { Rig } from './support.mjs'

test('SPEC[lifecycle-003] request identity binds canonical input and does not append on replay', () => {
  const rig = new Rig()
  const first = rig.open()
  const replay = rig.call({ openingCursor: 0, ownerId: 'manager', sequence: rig.sequence, root: rig.openCommand.root, type: 'Open' }, 'open')
  assert.equal(replay.status, 'Replayed')
  assert.deepEqual(replay.result, first)
  assert.equal(rig.count, 1)
  const conflict = rig.call({ ...rig.openCommand, root: 'other-root' }, 'open')
  assert.equal(conflict.status, 'Conflict')
  assert.equal(conflict.record, null)
  assert.equal(conflict.reason, 'RequestIdConflict')
  assert.equal(rig.count, 1)
})

test('SPEC[lifecycle-003] self-review and a second distinct review are rejected without writes', () => {
  const rig = new Rig()
  const opened = rig.open()
  const review = { type: 'Review', incumbencyId: opened.incumbencyId, reviewerId: 'manager', findings: [] }
  assert.throws(() => rig.call(review), /own incumbency/)
  assert.equal(rig.count, 1)
  rig.apply({ ...review, reviewerId: 'reviewer' }, 'review')
  assert.throws(() => rig.call({ ...review, reviewerId: 'another-reviewer' }), /already reviewed/)
  assert.equal(rig.count, 2)
})

test('SPEC[lifecycle-003] findings are returned but are not copied into the review event', () => {
  const rig = new Rig()
  rig.open()
  const findings = ['Private review detail.']
  assert.deepEqual(rig.review(findings).findings, findings)
  assert.equal(JSON.stringify(rig.work.history()).includes(findings[0]), false)
  assert.equal('findings' in rig.work.history().at(-1).events[0], false)
})

test('SPEC[lifecycle-003] stale retirement replays do not act on a successor', () => {
  const rig = new Rig(['S4'])
  rig.open()
  rig.review(['Not done.'])
  const retirement = rig.delivery({ toolCallId: 'last-call' })
  const retired = rig.apply(retirement, 'retire')
  const successor = rig.work.inspect().active.id
  const writes = rig.count
  assert.equal(rig.call(retirement, 'different-request-same-fence').result.retirementId, retired.retirementId)
  assert.equal(rig.work.inspect().active.id, successor)
  assert.equal(rig.count, writes)
})

test('SPEC[lifecycle-003] snapshots and histories are detached views', () => {
  const rig = new Rig()
  rig.open()
  const snapshot = rig.work.inspect()
  snapshot.active.ownerId = 'intruder'
  snapshot.sequence[0] = 'S4'
  rig.work.history()[0].events[0].root = 'rewritten'
  assert.equal(rig.work.inspect().active.ownerId, 'manager')
  assert.equal(rig.work.inspect().sequence[0], 'S1')
  assert.equal(rig.work.inspect().root, rig.openCommand.root)
})

for (const value of [-1, 0.5, Infinity, NaN, '0', null, Number.MAX_SAFE_INTEGER + 1]) {
  test(`SPEC[lifecycle-003] invalid cursor ${String(value)} causes zero appends`, () => {
    const rig = new Rig()
    assert.throws(() => rig.open({ openingCursor: value }))
    assert.equal(rig.count, 0)
  })
}

test('SPEC[lifecycle-003] unknown fields, sequence and commands do not become new facts', () => {
  const rig = new Rig()
  assert.throws(() => rig.open({ sequence: ['S1'] }), /Sequence/)
  assert.throws(() => rig.open({ snapshotId: 'forbidden' }), /Unknown field/)
  assert.throws(() => rig.call({ type: 'suicide' }), /Unknown work command/)
  assert.equal(rig.count, 0)
  rig.open()
  assert.throws(() => rig.call({ type: 'Review', incumbencyId: 'another-tenure', reviewerId: 'reviewer', findings: [] }), /mismatch/)
  assert.throws(() => rig.deliver({ nextOwnerId: '' }), /empty/)
  assert.equal(rig.count, 1)
})

test('SPEC[lifecycle-003] identifiers cannot be changed by a native UTF-8 binding', () => {
  const rig = new Rig()
  for (const value of ['key\u0000suffix', '\ud800']) {
    assert.throws(() => new Work(value), /valid text/)
    assert.throws(() => rig.open({ ownerId: value }), /valid text/)
  }
  assert.equal(rig.count, 0)
})
