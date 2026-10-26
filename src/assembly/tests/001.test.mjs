import test from 'node:test'
import assert from 'node:assert/strict'
import { Work } from 'wanxiangli/work'
import { DurableWork } from 'wanxiangli/durable-work'
import { Rig, countingPorts } from './support.mjs'

test('SPEC[assembly-001] a real composition commits complete domain records and restores them', t => {
  const rig = new Rig(t)
  const reviewed = rig.review([{ key: 'gap', value: 'fix' }])
  assert.equal(reviewed.kind, 'Reviewed')
  const before = rig.journal.read('work-a')
  const restored = rig.reopen()
  assert.equal(restored.inspect().milestone, '事实与取舍')
  assert.deepEqual(restored.inspect(), rig.work.inspect())
  assert.deepEqual(restored.records(), before)
  assert.deepEqual(new Work('work-a', before).inspect(), restored.inspect())
  assert.deepEqual(rig.journal.read('work-a'), before)
})

test('SPEC[assembly-001] local-first recording and durable-first publication use unchanged Work and Journal', t => {
  const rig = new Rig(t)
  const local = new Work('work-a')
  const command = { type: 'Review', office: 'Manager', providerRunId: 'run', toolCallId: 'call-1', updates: [{ key: 'gap', value: 'fix' }] }
  assert.equal(local.execute('review', command).status, 'Applied')
  assert.deepEqual(rig.journal.read('work-a'), [])
  assert.equal(local.recover().next, 'Review')
  for (const [index, body] of local.records().entries()) {
    assert.equal(rig.journal.append('work-a', index, JSON.parse(body).requestId, body).status, 'Committed')
  }
  assert.deepEqual(rig.work.inspect(), local.inspect())
  const live = new DurableWork('live', rig.journal)
  assert.equal(live.execute('review', command).status, 'Committed')
  assert.equal(live.recover().next, 'Review')
  assert.deepEqual(live.history().map(frame => frame.events.map(event => event.type)), local.history().map(frame => frame.events.map(event => event.type)))
})

test('SPEC[assembly-001] only a fresh durable reservation runs its external effect once', t => {
  const ports = countingPorts()
  const rig = new Rig(t, ports)
  const command = { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'ask-1', updates: [] }
  const first = rig.call(command, 'reserve')
  assert.equal(first.status, 'Committed')
  assert.equal(first.result.kind, 'Asked')
  assert.equal(first.result.effect.text, '我需要干什么？')
  assert.equal(ports.counts.ask, 1)
  const questionId = first.result.effect.id
  assert.deepEqual(ports.ids, [questionId])
  const again = rig.reopen().execute('reserve', command)
  assert.equal(again.status, 'Replayed')
  assert.equal(again.result.kind, 'Asked')
  assert.equal(again.result.effect.id, questionId)
  assert.equal(ports.counts.ask, 1)
  assert.equal(rig.work.inspect().wait, 'AwaitOperatorAnswer')
})

test('SPEC[assembly-001] malformed domain messages cause no physical append', t => {
  const rig = new Rig(t)
  const before = rig.journal.read('work-a')
  assert.throws(() => rig.call({ type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'call', updates: [{ key: '', value: 'x' }] }))
  assert.throws(() => rig.call({ type: 'Deliver' }))
  assert.deepEqual(rig.journal.read('work-a'), before)
  rig.review([{ key: 'gap', value: 'fix' }])
})
