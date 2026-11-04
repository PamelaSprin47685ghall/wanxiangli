import test from 'node:test'
import assert from 'node:assert/strict'
import { Rig } from './support.mjs'

// 结案后的工作没有活动任期。外层组合者因未完成的工作需要继续时，
// 用独立的系统续办请求重开；它不冒充操作员消息，重放也不产生第二个任期。

function reachCompleted(office = 'Manager') {
  const rig = new Rig(office, `work-${office}`)
  // 执行：实账一笔，空账接力；接任第一次空账推进里程碑。
  rig.review([{ key: 'gap', value: 'keep' }])
  const relay = rig.review([{ key: 'gap', value: null }])
  assert.equal(relay.kind, 'Relayed')
  rig.send(relay)
  const advance = rig.review([])
  assert.equal(advance.kind, 'Advanced')
  assert.equal(advance.milestone, '收尾')
  rig.send(advance)
  // 收尾：空账结案，落一条 Stop。
  const closed = rig.review([])
  assert.equal(closed.kind, 'Completed')
  assert.equal(closed.effect.kind, 'Stop')
  return { rig, closed }
}

test('SPEC[lifecycle-010] Stop 未观察前拒绝续办', () => {
  const { rig } = reachCompleted()
  const refused = rig.call({ type: 'ContinueWork', continuationId: 'cont-unobserved' })
  assert.equal(refused.status, 'Conflict')
  assert.equal(refused.reason, 'Previous execution stop is not observed')
})

test('SPEC[lifecycle-010] Stop 观察后续办开新任期，不冒充操作员', () => {
  const { rig, closed } = reachCompleted()
  rig.confirm(closed.effect, 'Requested')
  rig.confirm(closed.effect, 'Observed')

  const continued = rig.apply({ type: 'ContinueWork', continuationId: 'cont-1' })
  assert.equal(continued.kind, 'Reopened')
  const snapshot = rig.work.inspect()
  assert.equal(snapshot.completed, false)
  assert.equal(snapshot.milestone, '执行')
  assert.equal(snapshot.active.origin, 'Originator')
  assert.equal(snapshot.active.substantive, false)

  // 续办不是操作员消息：它不写 messageId，另有自己的一条事实。
  const events = rig.work.history().flatMap(frame => frame.events)
  assert.equal(events.filter(event => event.type === 'WorkContinued').length, 1)
  assert.equal(events.filter(event => event.type === 'WorkContinued')[0].continuationId, 'cont-1')
  assert.equal(events.some(event => event.messageId === 'cont-1'), false)
  rig.restored()
})

test('SPEC[lifecycle-010] 同一续办请求重放不产生第二个任期', () => {
  const { rig, closed } = reachCompleted()
  rig.confirm(closed.effect, 'Requested')
  rig.confirm(closed.effect, 'Observed')
  rig.apply({ type: 'ContinueWork', continuationId: 'cont-replay' }, 'continue-request')

  const before = rig.work.inspect().active.id
  const replay = rig.work.execute('continue-request', { type: 'ContinueWork', continuationId: 'cont-replay' })
  assert.equal(replay.status, 'Replayed')
  assert.equal(rig.work.inspect().active.id, before)
  assert.equal(rig.work.history().flatMap(frame => frame.events).filter(event => event.type === 'WorkContinued').length, 1)

  // 另一请求同一 continuationId：任期身份已经封存，不再开第二个。
  const second = rig.work.execute('continue-other', { type: 'ContinueWork', continuationId: 'cont-replay' })
  assert.equal(second.status, 'Observed')
  assert.equal(rig.work.inspect().active.id, before)
  assert.equal(rig.work.history().flatMap(frame => frame.events).filter(event => event.type === 'WorkContinued').length, 1)
})

test('SPEC[lifecycle-010] 未结案的工作不接受续办', () => {
  const rig = new Rig('Manager', 'work-open')
  rig.review([{ key: 'job', value: 'do' }])
  const refused = rig.call({ type: 'ContinueWork', continuationId: 'cont-early' })
  assert.equal(refused.status, 'Conflict')
  assert.equal(refused.reason, 'Continuation requires completion')
})

test('SPEC[lifecycle-010] 续办后的任期按普通评审推进并再次结案', () => {
  const { rig, closed } = reachCompleted()
  rig.confirm(closed.effect, 'Requested')
  rig.confirm(closed.effect, 'Observed')
  rig.apply({ type: 'ContinueWork', continuationId: 'cont-next' })

  // 新任期从「执行」重新起步：实账、空账接力、接任晋级到收尾，再空账结案。
  rig.review([{ key: 'repair', value: 'keep' }])
  const relay = rig.review([{ key: 'repair', value: null }])
  assert.equal(relay.kind, 'Relayed')
  rig.send(relay)
  const advance = rig.review([])
  assert.equal(advance.kind, 'Advanced')
  assert.equal(advance.milestone, '收尾')
  rig.send(advance)
  const closedAgain = rig.review([])
  assert.equal(closedAgain.kind, 'Completed')
  assert.equal(rig.work.inspect().completed, true)
  rig.restored()
})
