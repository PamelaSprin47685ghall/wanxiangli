import test from 'node:test'
import assert from 'node:assert/strict'
import { Work } from 'wanxiangli/work'
import { Rig, canonical } from './support.mjs'

test('SPEC[lifecycle-004] Work accepts records, not a storage service or callbacks', () => {
  let called = false
  const service = { read() { called = true; return [] }, append() { called = true } }
  assert.throws(() => new Work('work-a', service), /array of records/)
  assert.equal(called, false)
  const work = new Work('work-a')
  assert.equal(work.recover().next, 'Open')
  assert.deepEqual(work.records(), [])
  assert.deepEqual(Object.keys(work).sort(), ['execute', 'history', 'inspect', 'records', 'recover'])
  for (const value of Object.values(work)) assert.equal(typeof value, 'function')
  assert.equal(work.state, undefined)
  assert.equal(work.saved, undefined)
  assert.equal(work.rebuild, undefined)
})

for (const [name, corrupt] of [
  ['half opening', frame => { frame.events.pop() }],
  ['unknown event', frame => { frame.events[0].type = 'UnknownEvent' }],
  ['foreign field', frame => { frame.events[0].snapshotId = 'foreign-vocabulary' }],
  ['wrong stage', frame => { frame.events[1].stage = 'S4' }],
  ['wrong hash', frame => { frame.requestHash = 'invalid' }],
]) {
  test(`SPEC[lifecycle-004] restoring ${name} rejects the complete history`, () => {
    const rig = new Rig()
    rig.open()
    const frame = rig.work.history()[0]
    corrupt(frame)
    assert.throws(() => new Work('work-a', [canonical(frame)]))
    assert.equal(rig.work.inspect().active.ownerId, 'manager')
    assert.equal(rig.count, 1)
  })
}

test('SPEC[lifecycle-004] duplicate, noncanonical and foreign histories are not accepted', () => {
  const rig = new Rig()
  rig.open()
  const records = rig.work.records()
  assert.throws(() => new Work('work-a', [...records, ...records]))
  assert.throws(() => new Work('work-a', [records[0] + '\n']), /canonical/)
  assert.throws(() => new Work('work-b', records), /identity/)
})

test('SPEC[lifecycle-004] a rejected successor cannot leave a half-retired object', () => {
  const rig = new Rig()
  rig.open({ openingCursor: 40 })
  rig.review()
  const before = rig.work.inspect()
  assert.throws(() => rig.deliver({ nextOwnerId: 'x'.repeat(1025) }), /Identifier/)
  assert.deepEqual(rig.work.inspect(), before)
  assert.throws(() => rig.deliver({ cursor: 39 }), /backwards/)
  assert.deepEqual(rig.work.inspect(), before)
  assert.equal(rig.count, 2)
  assert.equal(rig.deliver({ cursor: 41 }).kind, 'Relayed')
})

test('SPEC[lifecycle-004] input, response, history and recovery views never become private aliases', () => {
  const rig = new Rig()
  rig.open()
  rig.openCommand.root = 'changed externally'
  rig.openCommand.sequence[0] = 'S4'
  assert.notEqual(rig.work.inspect().root, rig.openCommand.root)
  assert.deepEqual(rig.work.inspect().sequence, ['S1', 'S2', 'S3'])
  const command = { type: 'Review', incumbencyId: rig.work.inspect().active.id, reviewerId: 'reviewer', findings: ['fix'] }
  const result = rig.call(command, 'review')
  command.findings.push('later input')
  result.result.findings.push('later result')
  result.result.outcome = 'Promoted'
  const replay = rig.call({ ...command, findings: ['fix'] }, 'review')
  assert.deepEqual(replay.result.findings, ['fix'])
  assert.equal(replay.result.outcome, 'Stayed')
  rig.deliver()
  rig.work.recover().state.rounds[0].ownerId = 'changed round'
  assert.equal(rig.work.inspect().rounds[0].ownerId, 'manager')
  const records = rig.work.records()
  const restored = new Work('work-a', records)
  records.length = 0
  assert.deepEqual(restored.inspect(), rig.work.inspect())
})

test('SPEC[lifecycle-004] replay results cannot change the stored pending operation', () => {
  const rig = new Rig()
  const { command, operationId } = rig.reserve()
  const reply = rig.call(command, 'reserve')
  reply.result.operationId = 'changed'
  rig.work.inspect().pendingDelivery.path = '/changed'
  assert.equal(rig.call(command, 'reserve').result.operationId, operationId)
  assert.equal(rig.work.inspect().pendingDelivery.path, '/plans/approved.md')
})

test('SPEC[lifecycle-004] a synchronous input getter cannot reenter the object', () => {
  const rig = new Rig()
  const command = { type: 'Open', sequence: ['S4'], ownerId: 'manager', openingCursor: 0,
    get root() { rig.work.execute('nested', { type: 'Open', root: 'nested', sequence: ['S4'], ownerId: 'nested', openingCursor: 0 }); return 'outer' } }
  assert.throws(() => rig.call(command), /reentrant/)
  assert.equal(rig.count, 0)
  assert.equal(rig.work.recover().next, 'Open')
  rig.open()
})
