import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { LocalEventStore, LocalIntegrator } from 'wanxiangli/local-eventstore'

function fixture(t, decorate = value => value) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'local-store-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const directory = () => path.join(root, 'events')
  const lockTarget = () => path.join(root, 'owner')
  const rules = [{
    name: 'sum', initial: 0,
    accepts: event => event.type === 'Add', faultScope: () => 'sum',
    integrate: (value, event) => ({ ok: true, value: value + event.payload.value }),
    planCut: () => ({ ok: false, error: 'unexpected cut' }),
    applyCut: value => ({ ok: true, value }),
  }]
  const makeIntegrator = () => new LocalIntegrator({ rules, isKnownEventType: value => value === 'Add' || value === 'ProjectionCutTail' })
  const integrator = makeIntegrator()
  const options = { directory, lockTarget, writerId: 'writer-a', segmentCap: 67108864, integrator: decorate(integrator, directory) }
  const store = new LocalEventStore(options)
  return { root, directory, lockTarget, integrator, store, options, makeIntegrator }
}
const event = (id, value = 1, parents = [], payloadRefs = []) => ({
  id, stream: 'work', type: 'Add', parents, payload: { value }, payloadRefs,
})

test('staged payload, committed Current and another writer share the same local log', async t => {
  const f = fixture(t)
  const bytes = Buffer.from('原文\0é')
  const reference = await f.store.writePayload(bytes)
  assert.equal(reference.ok, true)
  assert.deepEqual(await f.store.append([event('a', 2, [], [reference.value])]), { ok: true, value: { cuts: [] } })
  assert.equal(f.store.current('sum'), 2)
  const other = new LocalEventStore({ ...f.options, writerId: 'writer-b', integrator: f.makeIntegrator() })
  assert.deepEqual(Buffer.from((await other.readPayload(reference.value)).value), bytes)
  assert.deepEqual(other.heads('work'), ['a'])
  assert.equal((await other.append([event('b', 3, ['a'])])).ok, true)
  assert.equal(other.current('sum'), 5)
  assert.equal((await f.store.append([event('c', 4, ['b'])])).ok, true)
  assert.equal(f.store.current('sum'), 9)
  assert.deepEqual(f.store.heads('work'), ['c'])
  assert.equal(fs.existsSync(f.lockTarget() + '.lock'), false)
})

test('a Current reference changed after physical append still returns CommitUnknown', async t => {
  let armed = true
  const f = fixture(t, (integrator, directory) => ({
    reload: directory => integrator.reload(directory),
    prepare(events) {
      const prepared = integrator.prepare(events)
      if (!prepared.ok || !armed) return prepared
      armed = false
      return { ok: true, value: { ...prepared.value, commit() {
        assert.equal(integrator.reload(directory).ok, true)
        prepared.value.commit()
      } } }
    },
    isKnownEventType: value => integrator.isKnownEventType(value),
    current: key => integrator.current(key), event: id => integrator.event(id),
    payload: key => integrator.payload(key), heads: key => integrator.heads(key),
    head: key => integrator.head(key), allHeads: () => integrator.allHeads(),
  }))
  const outcome = await f.store.append([event('written', 7)])
  assert.equal(outcome.ok, false)
  assert.equal(outcome.error.kind, 'CommitUnknown')
  assert.equal(outcome.error.primary.phase, 'CurrentCommit')
  assert.match(outcome.error.primary.cause.message, /Current changed between prepare and durable append/)
  assert.equal(fs.readFileSync(path.join(f.directory(), 'writer-a-0000.ndjson'), 'utf8').trim().length > 0, true)
  const reopened = new LocalEventStore({ ...f.options, writerId: 'reader', integrator: f.makeIntegrator() })
  assert.equal(reopened.current('sum'), 7)
})

test('physical failure keeps its primary cause when close and lock release also fail', async t => {
  const f = fixture(t)
  const primary = new Error('fsync response failed')
  const close = new Error('close response failed')
  const release = new Error('release response failed')
  const originals = { fsyncSync: fs.fsyncSync, closeSync: fs.closeSync, openSync: fs.openSync, rmSync: fs.rmSync }
  const descriptors = new Set()
  const ownPath = path.join(f.directory(), 'writer-a-0000.ndjson')
  let armed = true
  fs.openSync = function (...args) {
    const fd = Reflect.apply(originals.openSync, this, args)
    if (path.resolve(String(args[0])) === ownPath) descriptors.add(fd)
    return fd
  }
  fs.fsyncSync = function (fd) {
    const result = Reflect.apply(originals.fsyncSync, this, [fd])
    if (armed && descriptors.has(fd)) throw primary
    return result
  }
  fs.closeSync = function (fd) {
    const owned = descriptors.delete(fd)
    const result = Reflect.apply(originals.closeSync, this, [fd])
    if (armed && owned) throw close
    return result
  }
  fs.rmSync = function (...args) {
    const result = Reflect.apply(originals.rmSync, this, args)
    if (armed && path.resolve(String(args[0])) === f.lockTarget() + '.lock') throw release
    return result
  }
  let outcome
  try { outcome = await f.store.append([event('failed')]) }
  finally { armed = false; Object.assign(fs, originals) }
  assert.equal(outcome.ok, false)
  assert.equal(outcome.error.kind, 'CommitUnknown')
  assert.equal(outcome.error.primary.phase, 'DurabilityBarrier')
  assert.equal(outcome.error.primary.cause, primary)
  assert.deepEqual(outcome.error.cleanupFailures, [
    { phase: 'DurabilityClose', cause: close }, { phase: 'StoreRelease', cause: release },
  ])
  assert.equal(f.store.current('sum'), 0)
})
