import test from 'node:test'
import assert from 'node:assert/strict'
import { Work } from 'wanxiangli/work'
import { Rig, canonical } from './support.mjs'

test('SPEC[lifecycle-004] a refused commit cannot leave a half-retired in-memory work', () => {
  const rig = new Rig()
  rig.open()
  rig.review()
  const before = rig.work.inspect()
  rig.journal.append = () => ({ status: 'NotWritten', revision: 2, reason: 'Unavailable' })
  const reply = rig.call(rig.delivery())
  assert.equal(reply.status, 'NotWritten')
  assert.equal(reply.result, null)
  assert.deepEqual(rig.work.inspect(), before)
})

for (const afterWrite of [false, true]) {
  test(`SPEC[lifecycle-004] unknown commit ${afterWrite ? 'after' : 'before'} durable write cannot grant dispatch`, () => {
    const rig = new Rig()
    rig.authorizePlan()
    const original = rig.journal.append.bind(rig.journal)
    rig.journal.append = (...args) => {
      if (afterWrite) original(...args)
      throw new Error('Lost acknowledgement')
    }
    const command = rig.delivery({ draft: { digest: 'draft', path: '/plan' } })
    const reply = rig.call(command, 'unknown-delivery')
    assert.equal(reply.status, 'Unknown')
    assert.equal(reply.result, null)
    assert.equal(rig.work.recover().next, 'ObserveCommit')
    assert.throws(() => rig.call(command, 'blind-retry'), /unknown/)
    rig.journal.append = original
    const restored = new Work('work-a', rig.journal)
    assert.equal(restored.recover().next, afterWrite ? 'ObserveExecution' : 'Continue')
    if (afterWrite) {
      assert.equal(restored.execute('unknown-delivery', command).result.kind, 'ObserveExecution')
    }
  })
}

test('SPEC[lifecycle-004] interleaved duplicate commits grant dispatch to only one caller', () => {
  const rig = new Rig()
  rig.authorizePlan()
  const other = new Work('work-a', rig.journal)
  const command = rig.delivery({ draft: { digest: 'draft', path: '/plan' } })
  const original = rig.journal.append.bind(rig.journal)
  let winner
  rig.journal.append = (...args) => {
    rig.journal.append = original
    winner = other.execute('same-request', command)
    return original(...args)
  }
  const loser = rig.call(command, 'same-request')
  assert.equal(winner.status, 'Committed')
  assert.equal(winner.result.kind, 'DispatchExecution')
  assert.equal(loser.status, 'Replayed')
  assert.equal(loser.result.kind, 'ObserveExecution')
})

test('SPEC[lifecycle-004] interleaved different requests return conflict without hidden retry', () => {
  const rig = new Rig()
  rig.authorizePlan()
  const other = new Work('work-a', rig.journal)
  const command = rig.delivery({ draft: { digest: 'draft', path: '/plan' } })
  const original = rig.journal.append.bind(rig.journal)
  let winner
  rig.journal.append = (...args) => {
    rig.journal.append = original
    winner = other.execute('other-request', { ...command, toolCallId: 'other-call' })
    return original(...args)
  }
  const loser = rig.call(command, 'first-request')
  assert.equal(winner.result.kind, 'DispatchExecution')
  assert.equal(loser.status, 'Conflict')
  assert.equal(loser.result, null)
  assert.equal(rig.work.inspect().pendingDelivery.operationId, winner.result.operationId)
})

for (const acknowledgement of [null, {}, { status: 'Committed', revision: -1 }, { status: 12 }]) {
  test(`SPEC[lifecycle-004] malformed acknowledgement ${JSON.stringify(acknowledgement)} freezes writes`, () => {
    const rig = new Rig()
    rig.open()
    const original = rig.journal.append.bind(rig.journal)
    rig.journal.append = (...args) => {
      original(...args)
      return acknowledgement
    }
    const reply = rig.call({ type: 'Review', incumbencyId: rig.work.inspect().active.id, reviewerId: 'reviewer', findings: [] })
    assert.equal(reply.status, 'Unknown')
    assert.equal(reply.result, null)
    assert.equal(rig.work.recover().next, 'ObserveCommit')
  })
}

for (const corrupt of [
  frame => { frame.events.pop() },
  frame => { frame.events[0].type = 'UnknownEvent' },
  frame => { frame.events[0].snapshotId = 'foreign-vocabulary' },
  frame => { frame.events[1].stage = 'S4' },
]) {
  test('SPEC[lifecycle-004] invalid history is rejected as a whole before another append', () => {
    const rig = new Rig()
    rig.open()
    const row = rig.journal.streams.get('work-a')[0]
    const frame = JSON.parse(row.body)
    corrupt(frame)
    row.body = canonical(frame)
    assert.throws(() => rig.work.inspect())
    assert.throws(() => rig.call({ type: 'Advance', incumbencyId: 'none', expected: 'old', next: 'new' }))
    assert.equal(rig.journal.calls, 1)
  })
}

test('SPEC[lifecycle-004] successor validation is identical before commit and after replay', () => {
  const rig = new Rig()
  rig.open()
  const before = rig.work.inspect()
  assert.throws(() => rig.deliver({ nextOwnerId: 'x'.repeat(1025) }), /Identifier/)
  assert.equal(rig.journal.calls, 1)
  assert.deepEqual(rig.work.inspect(), before)
})
