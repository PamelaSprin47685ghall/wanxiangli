import test from 'node:test'
import assert from 'node:assert/strict'
import { Rig } from './support.mjs'

function opened(rig) {
  return rig.review([{ key: 'gap', value: 'fix' }], {}, 'open')
}

test('SPEC[assembly-002] NotWritten discards the candidate without a half-retired durable work', t => {
  const rig = new Rig(t)
  opened(rig)
  const before = rig.work.inspect()
  const command = { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'clear', updates: [{ key: 'gap', value: null }] }
  const append = rig.journal.append.bind(rig.journal)
  rig.journal.append = () => ({ status: 'NotWritten', revision: before.revision, reason: 'Known rejection' })
  const result = rig.call(command, 'clear')
  assert.equal(result.status, 'NotWritten')
  assert.equal(result.result, null)
  rig.journal.append = append
  assert.deepEqual(rig.work.inspect(), before)
  assert.equal(rig.commit(command, 'clear').kind, 'Relayed')
})

for (const afterWrite of [false, true]) {
  test(`SPEC[assembly-002] lost acknowledgement ${afterWrite ? 'after' : 'before'} commit freezes only the composition`, t => {
    const rig = new Rig(t)
    opened(rig)
    const command = { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'clear', updates: [{ key: 'gap', value: null }] }
    const append = rig.journal.append.bind(rig.journal)
    rig.journal.append = (...args) => {
      if (afterWrite) append(...args)
      throw new Error('Lost acknowledgement')
    }
    const reply = rig.call(command, 'clear')
    assert.equal(reply.status, 'Unknown')
    assert.equal(reply.result, null)
    assert.equal(rig.work.recover().next, 'ObserveCommit')
    assert.throws(() => rig.work.inspect(), /unknown/)
    assert.throws(() => rig.call(command, 'retry'), /unknown/)
    const restored = rig.reopen()
    assert.equal(restored.recover().next, afterWrite ? 'ConfirmEffect' : 'Review')
    if (afterWrite) assert.equal(restored.recover().effect.kind, 'Dispatch')
    else assert.equal(restored.inspect().active.substantive, true)
  })
}

for (const sameRequest of [false, true]) {
  test(`SPEC[assembly-001] interleaved ${sameRequest ? 'same' : 'different'} requests have only one commit winner`, t => {
    const rig = new Rig(t)
    opened(rig)
    const other = rig.reopen()
    const command = { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'clear', updates: [{ key: 'gap', value: null }] }
    const append = rig.journal.append.bind(rig.journal)
    let winner
    rig.journal.append = (...args) => {
      winner = other.execute(sameRequest ? 'clear' : 'other', sameRequest ? command : { ...command, toolCallId: 'other-call' })
      return append(...args)
    }
    const loser = rig.call(command, 'clear')
    assert.equal(winner.status, 'Committed')
    assert.equal(winner.result.kind, 'Relayed')
    assert.equal(loser.status, sameRequest ? 'Replayed' : 'Conflict')
    if (sameRequest) assert.equal(loser.result.kind, 'Relayed')
    else assert.equal(loser.result, null)
    assert.equal(rig.work.inspect().revision, winner.revision)
  })
}

for (const acknowledgement of [null, {}, { status: 'Committed', revision: -1, reason: null }, { status: 12, revision: 1, reason: null }, { status: 'Committed', revision: 999, reason: null }]) {
  test(`SPEC[assembly-002] malformed acknowledgement ${JSON.stringify(acknowledgement)} never publishes the candidate`, t => {
    const rig = new Rig(t)
    opened(rig)
    const command = { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'clear', updates: [{ key: 'gap', value: null }] }
    const append = rig.journal.append.bind(rig.journal)
    rig.journal.append = (...args) => { append(...args); return acknowledgement }
    const reply = rig.call(command, 'clear')
    assert.equal(reply.status, 'Unknown')
    assert.equal(reply.result, null)
    assert.equal(rig.work.recover().next, 'ObserveCommit')
    const restored = rig.reopen()
    assert.equal(restored.inspect().active.origin, 'Successor')
    assert.equal(restored.recover().effect.kind, 'Dispatch')
  })
}

test('SPEC[assembly-002] a false replay acknowledgement cannot substitute another record', t => {
  const rig = new Rig(t)
  opened(rig)
  rig.journal.append = () => ({ status: 'Replayed', revision: 1, reason: null })
  const reply = rig.call({ type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'clear', updates: [{ key: 'gap', value: null }] }, 'clear')
  assert.equal(reply.status, 'Unknown')
  assert.equal(reply.result, null)
  assert.equal(rig.reopen().inspect().active.origin, 'Originator')
})

test('SPEC[assembly-002] valid storage bytes with invalid domain history are rejected without repair', t => {
  const rig = new Rig(t)
  opened(rig)
  const body = JSON.stringify({ events: [{ type: 'UnknownEvent' }], requestHash: '0'.repeat(64), requestId: 'foreign' })
  assert.equal(rig.journal.append('work-a', 1, 'foreign', body).status, 'Committed')
  assert.throws(() => rig.work.inspect(), /Unknown/)
  assert.throws(() => rig.call({ type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'x', updates: [] }), /Unknown/)
  assert.equal(rig.journal.read('work-a').length, 2)
})

test('SPEC[assembly-003] a synchronous append callback cannot reenter the same composition', t => {
  const rig = new Rig(t)
  opened(rig)
  const command = { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'again', updates: [{ key: 'gap', value: 'more' }] }
  const append = rig.journal.append.bind(rig.journal)
  rig.journal.append = (...args) => {
    assert.throws(() => rig.call(command, 'nested'), /reentrant/)
    assert.throws(() => rig.work.inspect(), /reentrant/)
    assert.throws(() => rig.work.recover(), /reentrant/)
    return append(...args)
  }
  assert.equal(rig.call(command, 'outer').status, 'Committed')
  assert.equal(rig.work.inspect().active.substantive, true)
})

test('SPEC[assembly-003] request mutation during a race does not change the correlated replay', t => {
  const rig = new Rig(t)
  opened(rig)
  const command = { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'again', updates: [{ key: 'gap', value: 'more' }] }
  const other = rig.reopen()
  const append = rig.journal.append.bind(rig.journal)
  rig.journal.append = (...args) => {
    assert.equal(other.execute('again', command).status, 'Committed')
    command.updates.push({ key: 'extra', value: 'mutated' })
    return append(...args)
  }
  const reply = rig.call(command, 'again')
  assert.equal(reply.status, 'Replayed')
  assert.deepEqual(reply.result.obligations, [{ key: 'gap', value: 'more' }])
})
