import test from 'node:test'
import assert from 'node:assert/strict'
import { Prefix } from 'wanxiangli/prefix'

const prefix = new Prefix()
const compaction = run => ({ kind: 'compaction', run })
const tenure = incumbencyId => ({ kind: 'tenure', incumbencyId })
const commitOk = (state, candidate) => {
  const result = prefix.commit(state, candidate)
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.state
}

test('SPEC[prefix-2] a committed compaction advances exactly one epoch and records its run', () => {
  const candidate = prefix.propose(prefix.empty(), compaction('c1'))
  assert.deepEqual(candidate, { previousEpoch: 0, nextEpoch: 1, evidence: compaction('c1') })
  const state = commitOk(prefix.empty(), candidate)
  assert.deepEqual(state, { epoch: 1, compactionRuns: ['c1'], tenures: [] })
})

test('SPEC[prefix-2] a committed tenure handover advances exactly one epoch and records the incumbency', () => {
  const state = commitOk(prefix.empty(), prefix.propose(prefix.empty(), tenure('inc-1')))
  assert.deepEqual(state, { epoch: 1, compactionRuns: [], tenures: ['inc-1'] })
  assert.equal(prefix.isReanchored(state, tenure('inc-1')), true)
  assert.equal(prefix.isReanchored(state, compaction('inc-1')), false, 'evidence kinds do not alias')
})

test('SPEC[prefix-2] only compaction and tenure evidence exist; anything else is refused loudly', () => {
  for (const kind of ['probe', 'capacity', 'tokens', 'view', '']) {
    assert.throws(() => prefix.propose(prefix.empty(), { kind, run: 'x' }), TypeError)
  }
})

test('SPEC[prefix-2] a non-successor epoch is corruption, not absorbed', () => {
  for (const nextEpoch of [0, 2, 9]) {
    assert.deepEqual(
      prefix.commit(prefix.empty(), { previousEpoch: 0, nextEpoch, evidence: compaction('c1') }),
      { ok: false, absorbed: false, error: 'NonSequentialEpoch' },
    )
  }
})

test('SPEC[prefix-2] a replayed line arrives stale and is absorbed without moving the epoch', () => {
  const first = commitOk(prefix.empty(), prefix.propose(prefix.empty(), tenure('inc-1')))
  const replay = prefix.commit(first, { previousEpoch: 0, nextEpoch: 1, evidence: compaction('c-new') })
  assert.deepEqual(replay, { ok: false, absorbed: true, error: 'StaleEpoch', expected: 1, actual: 0 })
})

test('SPEC[prefix-2] line epochs outside the current generation are judged, not crashed on', () => {
  assert.deepEqual(prefix.commit(prefix.empty(), { previousEpoch: -4, nextEpoch: -3, evidence: compaction('c1') }),
    { ok: false, absorbed: true, error: 'StaleEpoch', expected: 0, actual: -4 })
  assert.deepEqual(prefix.commit(prefix.empty(), { previousEpoch: 0, nextEpoch: 2 ** 40, evidence: compaction('c1') }),
    { ok: false, absorbed: false, error: 'NonSequentialEpoch' })
  assert.throws(() => prefix.commit(prefix.empty(), { previousEpoch: 0.5, nextEpoch: 1, evidence: compaction('c1') }), TypeError)
})
