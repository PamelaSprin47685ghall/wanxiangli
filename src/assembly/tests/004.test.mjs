import test from 'node:test'
import assert from 'node:assert/strict'
import { Rig, countingPorts } from './support.mjs'

test('SPEC[assembly-004] a promised park is confirmed once and a replay does not ask again', async (t) => {
  const ports = countingPorts()
  ports.ask = (effect) => {
    ports.counts.ask += 1
    ports.ids.push(effect.id)
    return Promise.resolve('Parked')
  }
  const rig = new Rig(t, ports)
  const command = {
    type: 'Review',
    office: 'Plan',
    providerRunId: 'run',
    toolCallId: 'ask-promised',
    updates: [],
  }
  const first = await rig.work.execute('reserve', command)
  assert.equal(first.status, 'Committed', JSON.stringify(first))
  assert.equal(first.result.kind, 'Asked')
  assert.equal(first.result.effect.text, '我需要干什么？')
  assert.equal(ports.counts.ask, 1)
  const again = await rig.reopen().execute('reserve', command)
  assert.equal(again.status, 'Replayed')
  assert.equal(again.result.kind, 'Asked')
  assert.equal(again.result.effect.id, first.result.effect.id)
  assert.equal(ports.counts.ask, 1)
  assert.equal(rig.work.inspect().wait, 'AwaitOperatorAnswer')
  console.log(`promised ask external ${ports.counts.ask}`)
})
