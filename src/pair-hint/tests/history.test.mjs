import test from 'node:test'
import assert from 'node:assert/strict'
import { PairGuidanceHistory, PairGuidanceOccurrences, PairGuidanceMemoryStore } from '../../../dist/pair-hint/PairHint.js'
const entry = (ordinal, callId, placementKey = 's|a:message') => ({ ordinal, callId, placementKey, markerText: '\uFEFForiginal\0', metadata: ['start', 'after:message'] })
const ok = value => ({ok:true, value})

test('history keeps immutable branches and durable rejection order', () => {
  const empty = new PairGuidanceHistory()
  const first = empty.append(entry(1n, 'one')).value
  assert.equal(empty.nextOrdinal(), 1n)
  assert.equal(first.nextOrdinal(), 2n)
  assert.equal(first.append(entry(1n, 'one')).error.kind, 'NonSequentialOrdinal')
  assert.equal(first.append(entry(2n, 'one')).error.kind, 'DuplicateCallId')
  assert.equal(first.append(entry(2n, 'two')).error.kind, 'DuplicatePlacement')
  const second = first.append(entry(2n, 'two', 'other')).value
  assert.deepEqual(first.history().map(x => x.callId), ['one'])
  assert.deepEqual(second.history().map(x => x.callId), ['one','two'])
  const view = second.history(); view[0].markerText = 'changed'; view.pop()
  assert.equal(second.history()[0].markerText, '\uFEFForiginal\0')
})

test('reanchor releases placements without forgetting calls or history', () => {
  const first = new PairGuidanceHistory().append(entry(1n, 'one')).value
  const anchored = first.reanchor()
  assert.deepEqual(anchored.visible(), [])
  assert.equal(anchored.placementCount(), 0)
  assert.equal(anchored.append(entry(2n, 'one')).error.kind, 'DuplicateCallId')
  const next = anchored.append(entry(2n, 'two')).value
  assert.deepEqual(next.visible().map(x => x.callId), ['two'])
  assert.deepEqual(next.callIds(), ['one', 'two'])
  assert.equal(next.restoreVisibilityFloor(0n).visibleFromOrdinal(), 1n)
  assert.equal(next.restoreVisibilityFloor(1n).history().length, 2)
  assert.equal(next.restoreVisibilityFloor(1n).placementCount(), 1)
})

test('memory append remains permissive and successor follows the final item', () => {
  const memory = new PairGuidanceMemoryStore()
  memory.append('s', entry(9n, 'same'))
  memory.append('s', entry(3n, 'same'))
  memory.append('s', entry(3n, 'same'))
  assert.equal(memory.read('s').length, 3)
  assert.equal(memory.nextOrdinal(memory.read('s')), 4n)
})

const input = (extra = {}) => ({ history:[], visible:[], occupied:[], syntheticCallIds:[], placement:ok({callGapKey:'Start',resultGapKey:'After:m',metadata:['s','a:m']}),skipNew:false,sessionKey:'s',markerText:'original',...extra })

test('occurrence renders before append and returns only committed wire', async () => {
  const owner = new PairGuidanceOccurrences()
  const calls = []
  const result = await owner.occur(input(), rows => { calls.push('render'); return ok(rows) }, async item => { calls.push('append'); assert.equal(item.ordinal,1n); return ok(null) })
  assert.deepEqual(calls,['render','append'])
  assert.equal(result.value.appended,true)
  assert.equal(result.value.wire[0].markerText,'original')
})

test('occurrence preserves render and append failures and promise rejection', async () => {
  const owner = new PairGuidanceOccurrences()
  const cause = new Error('original')
  let calls = 0
  const badRender = await owner.occur(input(), () => ({ok:false,error:cause}), async () => { calls++; return ok(null) })
  assert.equal(calls,0); assert.equal(badRender.error.cause,cause)
  const badAppend = await owner.occur(input(), rows => ok(rows), async () => ({ok:false,error:cause}))
  assert.equal(badAppend.ok,false); assert.equal(badAppend.error.kind,'Append'); assert.equal(badAppend.error.cause,cause)
  await assert.rejects(owner.occur(input(), rows => ok(rows), async () => {throw cause}), error => error === cause)
})

test('occupied, skipped and unplaced requests replay without a new append', async () => {
  const owner = new PairGuidanceOccurrences()
  const visible = [entry(1n,'original')]
  for (const extra of [{skipNew:true},{placement:null},{occupied:[{callGapKey:'Start',resultGapKey:'After:m'}]}]) {
    const result = await owner.occur(input({history:visible,visible,...extra}), rows => ok(rows), async () => {throw Error('must not append')})
    assert.deepEqual(result.value.wire, visible)
    assert.equal(result.value.appended,false)
  }
})

test('orphan rejection precedes placement refusal and large ordinals stay bigint', async () => {
  const owner = new PairGuidanceOccurrences()
  const orphan = await owner.occur(input({syntheticCallIds:['missing'],placement:{ok:false,error:'bad'}}),()=>{throw Error('render')},async()=>{throw Error('append')})
  assert.equal(orphan.error.kind,'Orphaned')
  const ordinal = 9007199254740993n
  const result = await owner.occur(input({history:[entry(ordinal,'old')]}),rows=>ok(rows),async()=>ok(null))
  assert.equal(result.value.wire[0].ordinal, ordinal + 1n)
})
