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
    assert.throws(() => work.execute('self-review', { type: 'Review', incumbencyId: tenure, reviewerId: 'owner', updates: [] }))
    assert.deepEqual(work.inspect(), before)
    const review = { type: 'Review', incumbencyId: tenure, reviewerId: 'other', updates: [{ key: 'unfinished', value: 'unfinished' }] }
    assert.equal(work.execute('review', review).status, fresh)
    assert.equal(work.execute('review', review).status, 'Replayed')
    // A stayed review leaves a non-empty ledger, so clear it before relay.
    work.execute('clear-review', { type: 'Review', incumbencyId: tenure, reviewerId: 'other', updates: [{ key: 'unfinished', value: null }] })
    // Single delivery: eligibility stays locked as Stayed, so a single deliver
    // call atomically relays to a successor tenure.
    const relay = { type: 'Deliver', incumbencyId: tenure, providerRunId: 'run', toolCallId: 'relay', cursor: 10, blockers: [], nextOwnerId: 'next' }
    const relayed = work.execute('relay', relay)
    assert.equal(relayed.status, fresh)
    assert.equal(relayed.result.kind, 'Relayed')
    assert.notEqual(work.inspect().active.id, tenure)
    assert.equal(work.inspect().active.reviewOutcome, null)
    // Fence replay on the retired fence returns the recorded Relayed result.
    assert.equal(work.execute('relay-replay', relay).result.kind, 'Relayed')
    const reconstructed = new Work('contract', work.records())
    assert.deepEqual(reconstructed.inspect(), work.inspect())
    assert.equal(work.records().length, 4)
    const exposed = work.inspect()
    exposed.rounds[0].ownerId = 'outsider'
    assert.equal(work.inspect().rounds[0].ownerId, 'owner')
  })
}
