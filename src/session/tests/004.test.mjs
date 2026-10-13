import test from 'node:test'
import assert from 'node:assert/strict'
import { Ownership } from 'wanxiangli/ownership'
import { Rig, open, started, ended, reserve, binding, canonical, resign, unchanged } from './support.mjs'

function history() {
  const rig = new Rig()
  rig.apply(open(), 'open')
  const lease = rig.apply(reserve(), 'reserve').lease
  rig.apply(started(lease), 'started')
  rig.apply({ type: 'Drain', scopeId: 'work' }, 'drain')
  return { rig, lease }
}

test('SPEC[ownership-004] recovery rebuilds reservations, bindings, drain and old receipt identity without effects', () => {
  const { rig, lease } = history()
  const restored = new Ownership('registry', rig.owner.records())
  assert.deepEqual(restored.inspect(), rig.owner.inspect())
  assert.deepEqual(restored.head(), rig.owner.head())
  assert.deepEqual(restored.blockers('work'), rig.owner.blockers('work'))
  assert.equal(restored.execute('started', started(lease)).status, 'Replayed')
  assert.equal(restored.execute('same-message', started(lease)).status, 'Observed')
  assert.deepEqual(restored.records(), rig.owner.records())
  restored.execute('end', ended(lease))
  restored.execute('close', { type: 'Close', scopeId: 'work' })
  assert.equal(restored.scope('work').phase, 'Closed')
  assert.equal(rig.owner.scope('work').phase, 'Draining')
})

test('SPEC[ownership-004] request identity binds canonical message content, not object key order', () => {
  const rig = new Rig()
  const original = rig.call(open(), 'request')
  assert.deepEqual(rig.call({ parentId: null, scopeId: 'work', type: 'OpenScope' }, 'request'), { ...original, status: 'Replayed' })
  unchanged(rig.owner, () => rig.call(open('different'), 'request'), /Request identity conflict/)
})

for (const [name, alter] of [
  ['missing row', rows => rows.filter((_, index) => index !== 1)],
  ['duplicate row', rows => [...rows, rows[1]]],
  ['reordered rows', rows => [rows[1], rows[0], ...rows.slice(2)]],
  ['uncommitted body alteration', rows => rows.map((row, index) => index === 2 ? row.replace('container', 'different') : row)],
  ['unknown field', rows => rows.map((row, index) => index === 2 ? canonical({ ...JSON.parse(row), extra: true }) : row)],
  ['noncanonical encoding', rows => rows.map(row => row + '\n')],
  ['invalid JSON', rows => [...rows, '{']],
]) test(`SPEC[ownership-004] restore rejects ${name}`, () => {
  const { rig } = history()
  assert.throws(() => new Ownership('registry', alter(rig.owner.records())))
})

for (const [name, mutate] of [
  ['missing parent', frames => { frames[0].message.parentId = 'missing' }],
  ['self cycle', frames => { frames[0].message.parentId = 'work' }],
  ['foreign lease', frames => { frames[2].message.lease.registryId = 'foreign' }],
  ['forged lease', frames => { frames[2].message.lease.token = 'forged' }],
  ['unknown operation', frames => { frames[2].message.type = 'ReleaseEverything' }],
  ['duplicate request', frames => { frames[2].requestId = frames[1].requestId }],
  ['close with unresolved work', frames => { frames[3].message.type = 'Close' }],
  ['fake recorded no-op', frames => { frames[3].message = { type: 'Unknown', lease: frames[2].message.lease } }],
]) test(`SPEC[ownership-004] a recomputed checksum cannot admit ${name}`, () => {
  const { rig } = history()
  const frames = rig.owner.records().map(JSON.parse)
  mutate(frames)
  assert.throws(() => new Ownership('registry', resign(frames)))
})

test('SPEC[ownership-004] an independent trusted head exposes tail truncation, not a made-up completeness guarantee', () => {
  const { rig } = history()
  const trusted = rig.owner.head()
  const shortened = new Ownership('registry', rig.owner.records().slice(0, -1))
  assert.notDeepEqual(shortened.head(), trusted)
  assert.equal(shortened.scope('work').phase, 'Open')
  assert.equal(shortened.blockers('work').length, 1)
  assert.throws(() => new Ownership('foreign', rig.owner.records()), /Foreign/)
})

test('SPEC[ownership-004] replay permutations preserve exact history and active resource conservation', () => {
  const rig = new Rig()
  rig.open()
  const events = []
  for (let index = 0; index < 80; index++) {
    const lease = rig.reserve(`resource-${index}`)
    const event = index % 2 === 0 ? ended(lease, binding('container', `instance-${index}`)) : { type: 'NotStarted', lease, reason: 'Refused.' }
    events.push(event)
    rig.apply(event, `settle-${index}`)
  }
  const restored = new Ownership('registry', rig.owner.records())
  const before = restored.records()
  for (let index = 0; index < events.length; index++) {
    const selected = (index * 37) % events.length
    assert.equal(restored.execute(`settle-${selected}`, events[selected]).status, 'Replayed')
  }
  assert.deepEqual(restored.records(), before)
  assert.equal(restored.inspect().resources, 80)
  assert.equal(restored.inspect().unsettled, 0)
})

test('SPEC[ownership-004] the constructor accepts only bounded complete records, never a storage service', () => {
  for (const value of [{ read() { throw Error('must not call') } }, [null], [1], Array(1), [' '.repeat(65537)]]) {
    assert.throws(() => new Ownership('registry', value))
  }
})
