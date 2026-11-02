import test from 'node:test'
import assert from 'node:assert/strict'
import { HandleHistory } from 'wanxiangli/handle-lifecycle'

const handle = { kind: 0, id: 'agent' }
const work = { handle, child: 'child', root: 'root' }
const binding = { handle, child: 'child', target: 'worker', byname: 'Name', role: 'worker', parentVisible: true }
const admission = { parent: 'parent', handle, profile: { child: 'child', role: 'worker', target: 'worker', root: 'root', logicalRun: 'run', identity: 'seed', owner: 'parent' }, landing: { child: 'child', identity: 'seed', ownerRoot: true } }
const cell = { kind: 'Terminal', reference: 'blob', digest: 'sha' }
const applied = result => { assert.equal(result.ok, true, result.error); return result.value }

test('history owns immutable bindings, ordering, names and exact admission identity', () => {
  const empty = new HandleHistory()
  const linked = applied(empty.link(binding))
  assert.equal(empty.bindings().length, 0)
  assert.equal(linked.nextCreationOrder, 1)
  assert.equal(linked.byname(' name ', true).handle.id, 'agent')
  assert.equal(applied(linked.link(binding)), linked)
  assert.equal(linked.link({ ...binding, child: 'other' }).error, 'HandleIdentityConflict')
  const returned = linked.binding(handle)
  returned.handle.id = 'changed'
  assert.equal(linked.binding(handle).handle.id, 'agent')
  assert.equal(linked.admit({ ...admission, landing: { ...admission.landing, identity: 'wrong' } }).error, 'WorkNotAdmitted')
  const admitted = applied(linked.admit(admission))
  assert.equal(admitted.work(work).logicalRun, 'run')
  assert.equal(applied(admitted.admit(admission)), admitted)
  assert.equal(admitted.admit({ ...admission, profile: { ...admission.profile, logicalRun: 'other' } }).error, 'HandleIdentityConflict')
  assert.equal(admitted.admit({ ...admission, profile: { ...admission.profile, root: 'other' } }).error, 'WorkStillActive')
})

test('history retains exact work tombstones and quarantines historical completion', () => {
  let history = applied(applied(new HandleHistory().link(binding)).admit(admission))
  history = applied(history.transitionWork({ event: 'complete', work, completion: cell }))
  assert.equal(history.summary(handle).phase, 'CompletedAwaitingJoin')
  assert.equal(history.transitionWork({ event: 'consume', work, completion: { ...cell, digest: 'wrong' }, consumptionId: 'take' }).error, 'ConsumptionMismatch')
  history = applied(history.transitionWork({ event: 'consume', work, completion: cell, consumptionId: 'take' }))
  assert.equal(history.work(work).consumptionId, 'take')
  assert.deepEqual(history.work(work).lastCompletion, cell)
  assert.equal(history.summary(handle).phase, 'Retired')
  assert.equal(applied(history.admit(admission)), history)
  assert.equal(history.admitted(work).error, 'HandleIsRetired')
  const legacy = applied(history.transition({ event: 'complete', handle, completion: cell }))
  assert.equal(legacy.admit(admission).error, 'LegacyWorkAmbiguous')
  assert.equal(legacy.admitted(work).error, 'LegacyWorkAmbiguous')
  assert.equal(legacy.summary(handle).work, null)
})
