import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { HandleHistory, DurableHandles, CompletionRecord } from 'wanxiangli/handle-lifecycle'

const hash = body => createHash('sha256').update(body).digest('hex')
const success = value => ({ ok: true, value })
const applied = result => { assert.equal(result.ok, true, result.error); return result.value }
const cell = (body, reference = 'blob') => ({ kind: 'Terminal', reference, digest: hash(body) })
const codec = new CompletionRecord()
function fixture(count = 1) {
  let history = new HandleHistory()
  let consumption = 0
  const blobs = new Map(), calls = [], entries = []
  for (let i = 0; i < count; i++) {
    const handle = { kind: 0, id: `agent-${i}` }, work = { handle, child: `child-${i}`, root: `root-${i}` }
    const binding = { handle, child: work.child, target: 'worker', byname: `worker-${i}`, role: 'worker', parentVisible: true }
    history = applied(history.link(binding))
    history = applied(history.admit({ parent: 'parent', handle, profile: { child: work.child, root: work.root, role: 'worker', target: 'worker', owner: 'parent', identity: `seed-${i}`, logicalRun: `run-${i}` }, landing: { child: work.child, identity: `seed-${i}`, ownerRoot: true } }))
    const body = codec.encode({ kind: 'completed', runId: `run-${i}`, view: '{"body":["raw"],"carry":[]}', childSessionId: work.child, authorityRoot: work.root, providerRun: `provider-${i}` })
    entries.push({ handle, work, binding, body, logicalRun: `run-${i}` })
  }
  const effects = {
    current: () => history,
    refresh: () => { calls.push('refresh'); return success(null) },
    append: async fact => {
      calls.push(fact.kind)
      switch (fact.kind) {
        case 'link': history = applied(history.link(fact.binding)); break
        case 'completeWork': history = applied(history.transitionWork({ event: 'complete', ...fact })); break
        case 'consumeWork': history = applied(history.transitionWork({ event: 'consume', ...fact })); break
        case 'abandonWork': history = applied(history.transitionWork({ event: 'abandon', ...fact })); break
        case 'retire': history = applied(history.transition({ event: 'retire', ...fact })); break
        case 'rejectFalseCompletion': history = applied(history.transition({ event: 'rejectFalseCompletion', ...fact })); break
      }
      return success(null)
    },
    writeBlob: async body => { calls.push('write'); const digest = hash(body); blobs.set(digest, body); return success({ reference: digest, digest }) },
    readBlob: async reference => { calls.push('read'); return blobs.has(reference) ? success(blobs.get(reference)) : { ok: false, error: 'missing blob' } },
    sha256: hash,
    mintConsumptionId: () => `take-${++consumption}`,
  }
  const controller = new DurableHandles(effects)
  const complete = (i = 0) => controller.complete({ ...entries[i], child: entries[i].work.child, kind: 'Terminal' })
  return { controller, effects, entries, blobs, calls, complete, get history() { return history }, set history(value) { history = value } }
}

test('durable handles write before fact, then consume exactly once after refreshed receipt', async () => {
  const f = fixture()
  assert.equal((await f.complete()).ok, true)
  assert.deepEqual(f.calls, ['write', 'completeWork'])
  f.calls.length = 0
  const delivered = applied(await f.controller.drain(32, () => true))
  assert.equal(delivered[0].payload.view, '{"body":["raw"],"carry":[]}')
  assert.deepEqual(f.calls, ['read', 'read', 'refresh', 'consumeWork', 'refresh'])
  assert.equal(f.history.work(f.entries[0].work).consumptionId, 'take-1')
  assert.deepEqual(applied(await f.controller.drain(32, () => true)), [])
})

test('completion rejects wrong work, mismatched run and failed append without faking durable success', async () => {
  const f = fixture()
  const entry = f.entries[0]
  assert.equal((await f.controller.complete({ ...entry, child: entry.work.child, kind: 'Terminal', logicalRun: 'other' })).error, 'completion logical run mismatch')
  assert.equal(f.calls.length, 0)
  f.effects.append = async () => ({ ok: false, error: 'unknown commit' })
  assert.equal((await f.complete()).error, 'unknown commit')
  assert.equal(f.history.work(entry.work).phase, 'Active')
})

test('consume refreshes stale cells, distinguishes another winner and unconfirmed own receipt', async () => {
  const f = fixture()
  await f.complete()
  const stale = f.history.summary(f.entries[0].handle)
  const append = f.effects.append
  f.effects.append = async fact => append({ ...fact, consumptionId: 'other-winner' })
  assert.equal((await f.controller.consume(stale)).kind, 'AlreadyRetired')
  const g = fixture()
  await g.complete()
  g.effects.append = async () => success(null)
  assert.equal((await g.controller.consume(g.history.summary(g.entries[0].handle))).error, 'exact consumption receipt was not confirmed')
})

test('drain retains delivered prefix on later failure, waits on invalid material, and propagates rejection', async () => {
  const f = fixture(2)
  await f.complete(0); await f.complete(1)
  f.blobs.delete(f.history.work(f.entries[1].work).completion.reference)
  const result = applied(await f.controller.drain(32, () => true))
  assert.equal(result.length, 1)
  assert.equal(f.history.work(f.entries[1].work).phase, 'CompletedAwaitingJoin')
  const g = fixture()
  const bad = 'invalid json', badCell = cell(bad)
  g.history = applied(g.history.transitionWork({ event: 'complete', work: g.entries[0].work, completion: badCell }))
  g.blobs.set('blob', bad)
  assert.deepEqual(applied(await g.controller.drain(32, () => true)), [])
  assert.equal(g.history.work(g.entries[0].work).phase, 'CompletedAwaitingJoin')
  g.effects.readBlob = async () => { throw new Error('read rejected') }
  await assert.rejects(g.controller.drain(32, () => true), /read rejected/)
})

test('filtered drain uses effective summary and reports voided work once', async () => {
  const f = fixture(2)
  await f.controller.abandon(f.entries[0].work, 'Voided')
  await f.complete(1)
  const seen = []
  const result = applied(await f.controller.drain(32, record => { seen.push(record.phase); return record.phase === 'Abandoned' }))
  assert.equal(result.length, 1)
  assert.equal(result[0].abandoned, 'Voided')
  assert.ok(seen.includes('Abandoned'))
  assert.equal(f.history.work(f.entries[1].work).phase, 'CompletedAwaitingJoin')
})

test('historical void is the only consumable unscoped state; false abort rejection keeps it out of join', async () => {
  const f = fixture()
  f.history = applied(f.history.transition({ event: 'abandon', handle: f.entries[0].handle, reason: 'Voided' }))
  assert.equal((await f.controller.consume(f.history.binding(f.entries[0].handle))).ok, true)
  assert.equal(f.history.binding(f.entries[0].handle).phase, 'Retired')
  const g = fixture()
  const body = '{"status":"aborted"}', completion = cell(body)
  g.blobs.set('blob', body)
  g.history = applied(g.history.transition({ event: 'complete', handle: g.entries[0].handle, completion }))
  assert.deepEqual(applied(await g.controller.drain(32, () => true)), [])
  assert.equal(g.history.binding(g.entries[0].handle).phase, 'Active')
})

test('cancel children stops at first append failure and keeps earlier abandoned work', async () => {
  const f = fixture(3), append = f.effects.append
  f.effects.append = async fact => fact.work.handle.id === 'agent-1' ? { ok: false, error: 'no write' } : append(fact)
  assert.equal((await f.controller.cancel(f.entries.map(entry => entry.handle), 'ParentCancelled')).error, 'no write')
  assert.equal(f.history.work(f.entries[0].work).phase, 'Abandoned')
  assert.equal(f.history.work(f.entries[2].work).phase, 'Active')
})
