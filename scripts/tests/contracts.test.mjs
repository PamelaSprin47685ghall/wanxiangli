import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { Work } from 'wanxiangli/work'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { DurableWork } from 'wanxiangli/durable-work'

// 两种整体保留同一领域承诺；状态名诚实区分内存应用和持久提交。
for (const mode of ['local', 'durable']) {
  test(`SPEC[build-003] the same domain contract holds for ${mode} work`, t => {
    const journal = mode === 'durable' ? new SqliteJournal(new DatabaseSync(':memory:')) : null
    t.after(() => journal?.close())
    const work = journal ? new DurableWork('contract', journal) : new Work('contract')
    const fresh = mode === 'durable' ? 'Committed' : 'Applied'
    const open = { type: 'Open', root: 'root', sequence: ['S4'], ownerId: 'owner', openingCursor: 0 }
    assert.equal(work.execute('open', open).status, fresh)
    const tenure = work.inspect().active.id
    const before = work.inspect()
    assert.throws(() => work.execute('self-review', { type: 'Review', incumbencyId: tenure, reviewerId: 'owner', findings: [] }))
    assert.deepEqual(work.inspect(), before)
    const review = { type: 'Review', incumbencyId: tenure, reviewerId: 'other', findings: ['unfinished'] }
    assert.equal(work.execute('review', review).status, fresh)
    assert.equal(work.execute('review', review).status, 'Replayed')
    const confirm = { type: 'Deliver', incumbencyId: tenure, providerRunId: 'run', toolCallId: 'first', cursor: 10, blockers: [], nextOwnerId: 'next' }
    assert.equal(work.execute('confirm', confirm).result.kind, 'Confirmed')
    const retired = work.execute('retire', { ...confirm, toolCallId: 'second' })
    assert.equal(retired.status, fresh)
    assert.equal(retired.result.kind, 'Relayed')
    assert.notEqual(work.inspect().active.id, tenure)
    assert.equal(work.inspect().active.reviewOutcome, null)
    assert.equal(work.execute('confirm', confirm).result.kind, 'Confirmed')
    const reconstructed = new Work('contract', work.records())
    assert.deepEqual(reconstructed.inspect(), work.inspect())
    assert.equal(work.records().length, 4)
    const exposed = work.inspect()
    exposed.rounds[0].ownerId = 'outsider'
    assert.equal(work.inspect().rounds[0].ownerId, 'owner')
  })
}
