import test from 'node:test'
import assert from 'node:assert/strict'
import { Prefix } from 'wanxiangli/prefix'

const prefix = new Prefix()
const compaction = run => ({ kind: 'compaction', run })
const tenure = incumbencyId => ({ kind: 'tenure', incumbencyId })

test('SPEC[prefix-3] a candidate is only a proposal: proposing never changes the committed state', () => {
  const state = prefix.empty()
  const before = JSON.stringify(state)
  const candidate = prefix.propose(state, compaction('c1'))
  prefix.propose(state, compaction('c2'))
  prefix.proposeCompaction(state, ['c1', 'c2', 'c3'])
  assert.equal(JSON.stringify(state), before)
  assert.equal(prefix.empty().epoch, 0)
  assert.throws(() => { candidate.nextEpoch = 7 }, TypeError, 'candidates are frozen')
  assert.throws(() => { state.compactionRuns.push('c9') }, TypeError, 'state arrays are frozen')
})

test('SPEC[prefix-3] already-committed evidence has no candidate', () => {
  const state = prefix.commit(prefix.empty(), prefix.propose(prefix.empty(), compaction('c1'))).state
  assert.equal(prefix.propose(state, compaction('c1')), null)
  assert.equal(prefix.proposeCompaction(state, ['c1']), null)
})

test('SPEC[prefix-3] the same compaction stays refused after an unrelated advance (well-formed stale decision)', () => {
  // 压缩消息永远留在宿主记录里；世代因任期交接前进后，旧压缩的新行会
  // 带着与现行世代一致的 previousEpoch 到来。只有证据集合能拒绝它。
  let state = prefix.commit(prefix.empty(), prefix.propose(prefix.empty(), compaction('c1'))).state
  state = prefix.commit(state, prefix.propose(state, tenure('inc-1'))).state
  assert.equal(state.epoch, 2)
  const forged = { previousEpoch: 2, nextEpoch: 3, evidence: compaction('c1') }
  assert.deepEqual(prefix.commit(state, forged), {
    ok: false, absorbed: true, error: 'AlreadyReanchored', evidence: compaction('c1'),
  })
})

test('SPEC[prefix-3] proposeCompaction picks the newest unhandled run, at most one', () => {
  const state = prefix.commit(prefix.empty(), prefix.propose(prefix.empty(), compaction('c1'))).state
  assert.deepEqual(prefix.proposeCompaction(state, ['c1', 'c2', 'c3']), {
    previousEpoch: 1, nextEpoch: 2, evidence: compaction('c3'),
  })
  assert.equal(prefix.proposeCompaction(state, []), null)
})

test('SPEC[prefix-3] a genuinely new compaction reanchors again and both stay recorded', () => {
  let state = prefix.empty()
  for (const run of ['c2', 'c1']) state = prefix.commit(state, prefix.propose(state, compaction(run))).state
  assert.deepEqual(state, { epoch: 2, compactionRuns: ['c1', 'c2'], tenures: [] })
})

test('SPEC[prefix-3] malformed state is refused, not defaulted', () => {
  for (const bad of [null, {}, { epoch: -1, compactionRuns: [], tenures: [] }, { epoch: 1.5, compactionRuns: [], tenures: [] },
    { epoch: 0, compactionRuns: [1], tenures: [] }, { epoch: '0', compactionRuns: [], tenures: [] }]) {
    assert.throws(() => prefix.propose(bad, compaction('c1')), TypeError, JSON.stringify(bad))
  }
  assert.deepEqual(prefix.normalize({ epoch: 3, compactionRuns: ['b', 'a', 'b'], tenures: [] }),
    { epoch: 3, compactionRuns: ['a', 'b'], tenures: [] })
})
