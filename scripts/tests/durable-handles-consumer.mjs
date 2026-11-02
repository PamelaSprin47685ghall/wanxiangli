import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { HandleHistory, DurableHandles, CompletionRecord } from 'wanxiangli/handle-lifecycle'

const success = value => ({ ok: true, value })
const apply = result => { assert.equal(result.ok, true, result.error); return result.value }
const handle = { kind: 0, id: 'child-handle' }
const work = { handle, child: 'child', root: 'root' }
let history = apply(new HandleHistory().link({ handle, child: 'child', target: 'worker', byname: 'worker', role: 'worker', parentVisible: true }))
history = apply(history.admit({ parent: 'parent', handle, profile: { child: 'child', role: 'worker', target: 'worker', root: 'root', logicalRun: 'run', identity: 'seed', owner: 'parent' }, landing: { child: 'child', identity: 'seed', ownerRoot: true } }))
const blobs = new Map()
const sha256 = body => createHash('sha256').update(body).digest('hex')
const controller = new DurableHandles({
  current: () => history,
  refresh: () => success(null),
  append: async fact => {
    assert.ok(fact.kind === 'completeWork' || fact.kind === 'consumeWork')
    history = apply(history.transitionWork({ event: fact.kind === 'completeWork' ? 'complete' : 'consume', ...fact }))
    return success(null)
  },
  writeBlob: async body => { const digest = sha256(body); blobs.set(digest, body); return success({ reference: digest, digest }) },
  readBlob: async reference => success(blobs.get(reference)),
  sha256,
  mintConsumptionId: () => 'take-once',
})
const body = new CompletionRecord().encode({ kind: 'completed', runId: 'run', view: '{"body":["result"],"carry":[]}', childSessionId: 'child', authorityRoot: 'root', providerRun: 'provider' })
apply(await controller.complete({ work, logicalRun: 'run', handle, child: 'child', kind: 'Terminal', body }))
const delivered = apply(await controller.drain(32, () => true))
assert.equal(delivered[0].payload.view, '{"body":["result"],"carry":[]}')
assert.equal(history.work(work).consumptionId, 'take-once')
assert.deepEqual(apply(await controller.drain(32, () => true)), [])
console.log(JSON.stringify({ durableHandles: true }))
