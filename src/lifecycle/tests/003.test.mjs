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

test('SPEC[lifecycle-003] self-review is rejected without writes and later reviews are keyed updates', () => {
  const rig = new Rig()
  const opened = rig.open()
  const review = { type: 'Review', incumbencyId: opened.incumbencyId, reviewerId: 'manager', updates: [] }
  assert.throws(() => rig.call(review), /own incumbency/)
  assert.equal(rig.count, 1)
  rig.apply({ ...review, reviewerId: 'reviewer' }, 'review')
  // A later review is not refused: it applies a keyed update without writes failing.
  const second = rig.apply({ type: 'Review', incumbencyId: opened.incumbencyId, reviewerId: 'another-reviewer', updates: [{ key: 'gap-1', value: 'close the gap' }] }, 'review-2')
  assert.equal(second.firstReview, false)
  assert.deepEqual(second.obligations, [{ key: 'gap-1', value: 'close the gap' }])
  assert.equal(rig.count, 3)
})

test('SPEC[lifecycle-003] keyed updates are applied item-by-item and a null value deletes', () => {
  const rig = new Rig()
  rig.open()
  const first = rig.review([{ key: 'gap-a', value: 'close a' }, { key: 'gap-b', value: 'close b' }])
  assert.equal(first.firstReview, true)
  assert.equal(first.outcome, 'Stayed')
  assert.deepEqual(first.obligations, [{ key: 'gap-a', value: 'close a' }, { key: 'gap-b', value: 'close b' }])
  // Item-by-item: overwrite one key, delete another, add a new one.
  const second = rig.review([{ key: 'gap-a', value: 'close a differently' }, { key: 'gap-b', value: null }, { key: 'gap-c', value: 'close c' }])
  assert.equal(second.firstReview, false)
  assert.deepEqual(second.obligations, [{ key: 'gap-a', value: 'close a differently' }, { key: 'gap-c', value: 'close c' }])
})

test('SPEC[lifecycle-003] stale retirement replays do not act on a successor', () => {
  const rig = new Rig(['S4'])
  rig.open()
  // First review is Stayed (non-empty ledger); a later review clears the keyed
  // ledger, leaving eligibility locked as Stayed, so deliver relays a successor.
  rig.review([{ key: 'gap', value: 'not done' }])
  rig.review([{ key: 'gap', value: null }])
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
  assert.throws(() => rig.call({ type: 'Review', incumbencyId: 'another-tenure', reviewerId: 'reviewer', updates: [] }), /mismatch/)
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

test('SPEC[lifecycle-003] promotion requires a fresh first review per stage; later empty update cannot gain eligibility', () => {
  const rig = new Rig()
  rig.open()
  // S1: first empty review → eligible; deliver promotes into a fresh S2 tenure.
  rig.review([])
  const promoted = rig.deliver()
  assert.equal(promoted.kind, 'Promoted')
  assert.equal(promoted.stage, 'S2')
  assert.equal(rig.work.inspect().stage, 'S2')
  assert.equal(rig.work.inspect().active.reviewOutcome, null, 'the promoted tenure is fresh, unqualified')
  // A second deliver with NO fresh review must not promote S2→S3.
  const secondDeliver = rig.deliver()
  assert.equal(secondDeliver.kind, 'Relayed', 'deliver cannot promote without a fresh first review')
  assert.equal(rig.work.inspect().stage, 'S2', 'the stage did not advance without a fresh review')
  // The relayed S2 tenure is also fresh; a nonempty first review makes it ineligible.
  rig.review([{ key: 'gap', value: 'open' }])
  assert.equal(rig.work.inspect().active.reviewOutcome, 'Stayed')
  // A later empty (clearing) review empties the ledger but must NOT gain eligibility.
  rig.review([{ key: 'gap', value: null }])
  assert.equal(rig.work.inspect().active.reviewOutcome, 'Stayed', 'a later empty update cannot gain eligibility')
  const relayed = rig.deliver()
  assert.equal(relayed.kind, 'Relayed', 'an ineligible tenure relays, never promotes')
  assert.equal(rig.work.inspect().stage, 'S2', 'the stage stays on the relay path')
})
