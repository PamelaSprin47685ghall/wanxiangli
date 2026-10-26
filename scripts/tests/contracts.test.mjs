import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { Work } from 'wanxiangli/work'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { DurableWork } from 'wanxiangli/durable-work'

for (const mode of ['local', 'durable']) {
  test(`SPEC[build-003] the same domain contract holds for ${mode} work`, t => {
    const journal = mode === 'durable' ? new SqliteJournal(new DatabaseSync(':memory:')) : null
    t.after(() => journal?.close())
    const work = journal ? new DurableWork('contract', journal) : new Work('contract')
    const fresh = mode === 'durable' ? 'Committed' : 'Applied'
    const review = { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'review-1', updates: [{ key: 'gap', value: 'fix' }] }
    assert.equal(work.execute('review', review).status, fresh)
    assert.equal(work.execute('review', review).status, 'Replayed')
    const before = work.records().length
    assert.throws(() => work.execute('bad', { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'bad', updates: [{ key: '', value: 'x' }] }))
    assert.equal(work.records().length, before)
    const relay = { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'clear-1', updates: [{ key: 'gap', value: null }] }
    const relayed = work.execute('relay', relay)
    assert.equal(relayed.status, fresh)
    assert.equal(relayed.result.kind, 'Relayed')
    assert.notEqual(work.inspect().active.id, relayed.result.predecessorId)
    assert.equal(work.execute('relay-again', relay).result.kind, 'Relayed')
    const reconstructed = new Work('contract', work.records())
    assert.deepEqual(reconstructed.inspect(), work.inspect())
    assert.equal(work.records().length, 2)
    const exposed = work.inspect()
    exposed.rounds[0].ownerId = 'outsider'
    assert.equal(work.inspect().rounds[0].ownerId, 'Plan')
  })
}
