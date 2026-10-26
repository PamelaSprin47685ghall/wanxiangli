import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { abandonLocalState } from 'wanxiangli/work'
import { Rig } from './support.mjs'

test('SPEC[lifecycle-006] DevOps binding survives relay and conflicts when changed', () => {
  const rig = new Rig()
  rig.review([{ key: 'gap', value: 'fix' }])
  const bound = rig.apply({ type: 'BindDevOps', trigger: 'Ask', devopsId: 'dev-1', target: 'model-a' })
  assert.equal(bound.kind, 'DevOpsBound')
  const again = rig.call({ type: 'BindDevOps', trigger: 'Ask', devopsId: 'dev-1', target: 'model-a' })
  assert.equal(again.status, 'Observed')
  const conflict = rig.call({ type: 'BindDevOps', trigger: 'Ask', devopsId: 'dev-1', target: 'model-b' })
  assert.equal(conflict.status, 'Conflict')
  const relay = rig.review([{ key: 'gap', value: null }])
  assert.equal(relay.kind, 'Relayed')
  assert.equal(rig.work.inspect().devopsId, 'dev-1')
  assert.equal(rig.work.inspect().devopsTarget, 'model-a')
  rig.restored()
})

test('SPEC[lifecycle-006] cleanup blocks while resources are open and completes when they are clear', () => {
  const rig = new Rig('Manager')
  rig.review([{ key: 'job', value: 'do' }])
  const relay = rig.review([{ key: 'job', value: null }])
  rig.send(relay)
  const advanced = rig.review([])
  assert.equal(advanced.milestone, '收尾')
  rig.send(advanced)
  const before = rig.count
  const blocked = rig.call({
    type: 'Review', office: 'Manager', providerRunId: 'run-1', toolCallId: 'block-1', updates: [], blockers: ['file-open'],
  })
  assert.equal(blocked.status, 'Observed')
  assert.equal(blocked.result.kind, 'Blocked')
  assert.equal(rig.count, before)
  assert.equal(rig.work.inspect().active.id, advanced.incumbencyId)
  const closed = rig.review([])
  assert.equal(closed.kind, 'Completed')
  assert.equal(closed.effect.kind, 'Stop')
  assert.equal(rig.work.inspect().milestone, '已完成')
  assert.equal(rig.work.inspect().active, null)
  rig.confirm(closed.effect, 'Requested')
  const observed = rig.confirm(closed.effect, 'Observed')
  assert.equal(observed.kind, 'Confirmed')
  assert.equal(observed.outcome, 'Observed')
  rig.restored()
})

test('SPEC[lifecycle-006] shock delete removes an isolated directory and refuses .Herdchestra', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wxs-abandon-'))
  writeFileSync(path.join(directory, 'old.json'), '{"type":"WorkOpened","sequence":["S1","S2","S3"]}')
  abandonLocalState(directory)
  assert.equal(existsSync(directory), false)
  const forbidden = path.resolve('.Herdchestra')
  const existed = existsSync(forbidden)
  assert.throws(() => abandonLocalState(forbidden), /Herdchestra/)
  assert.equal(existsSync(forbidden), existed)
})
