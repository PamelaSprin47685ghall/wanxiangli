import test from 'node:test'
import assert from 'node:assert/strict'
import { Work } from 'wanxiangli/work'
import { Rig, canonical } from './support.mjs'

test('SPEC[lifecycle-004] Work accepts records, not a storage service', () => {
  let called = false
  const service = { read() { called = true; return [] }, append() { called = true } }
  assert.throws(() => new Work('work-a', service), /array of records/)
  assert.equal(called, false)
  const work = new Work('work-a')
  assert.equal(work.recover().next, 'Review')
  assert.deepEqual(work.records(), [])
  assert.deepEqual(Object.keys(work).sort(), ['execute', 'history', 'inspect', 'records', 'recover'])
  for (const value of Object.values(work)) assert.equal(typeof value, 'function')
  assert.equal(work.state, undefined)
})

test('SPEC[lifecycle-004] an old S1 record is rejected and not translated', () => {
  const body = canonical({
    requestId: 'old-1',
    requestHash: 'ab'.repeat(32),
    events: [{ type: 'WorkOpened', workId: 'work-a', root: 'x', sequence: ['S1', 'S2', 'S3'], authorityInitial: 'abc' }],
  })
  assert.throws(() => new Work('work-a', [body]))
})

test('SPEC[lifecycle-004] a damaged record rejects the whole history', () => {
  const rig = new Rig()
  rig.review([])
  const frame = rig.work.history()[0]
  frame.events.pop()
  assert.throws(() => new Work('work-a', [canonical(frame)]))
  frame.events.push({ type: 'QuestionRequested' })
  frame.events[0].type = 'UnknownEvent'
  assert.throws(() => new Work('work-a', [canonical(frame)]), /Unknown lifecycle event/)
  const valid = rig.work.records()
  assert.throws(() => new Work('work-a', [...valid, ...valid]))
  assert.throws(() => new Work('work-a', [valid[0] + '\n']), /canonical/)
  assert.throws(() => new Work('work-b', valid), /identity/)
})

test('SPEC[lifecycle-004] returned views are not aliases of the stored work', () => {
  const rig = new Rig()
  const command = { type: 'Review', office: 'Plan', providerRunId: 'run-1', toolCallId: 'call-1', updates: [{ key: 'gap', value: 'fix' }] }
  const result = rig.apply(command, 'review-1')
  command.updates.push({ key: 'gap2', value: 'later' })
  result.obligations.push({ key: 'gap2', value: 'later' })
  result.kind = 'Relayed'
  const replay = rig.call({ type: 'Review', office: 'Plan', providerRunId: 'run-1', toolCallId: 'call-1', updates: [{ key: 'gap', value: 'fix' }] }, 'review-1')
  assert.equal(replay.result.kind, 'Reviewed')
  assert.deepEqual(replay.result.obligations, [{ key: 'gap', value: 'fix' }])
  rig.work.inspect().active.ownerId = 'changed'
  assert.equal(rig.work.inspect().active.ownerId, 'Plan')
  const records = rig.work.records()
  const restored = new Work('work-a', records)
  records.length = 0
  assert.deepEqual(restored.inspect(), rig.work.inspect())
})

test('SPEC[lifecycle-004] a synchronous input getter cannot reenter the object', () => {
  const rig = new Rig()
  const command = {
    type: 'Review',
    office: 'Plan',
    toolCallId: 'call-1',
    updates: [],
    get providerRunId() {
      rig.work.execute('nested', { type: 'Review', office: 'Plan', providerRunId: 'run-x', toolCallId: 'call-x', updates: [] })
      return 'run-1'
    },
  }
  assert.throws(() => rig.call(command), /reentrant/)
  assert.equal(rig.count, 0)
  assert.equal(rig.work.recover().next, 'Review')
})
