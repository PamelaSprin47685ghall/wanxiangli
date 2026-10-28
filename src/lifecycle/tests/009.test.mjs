import test from 'node:test'
import assert from 'node:assert/strict'
import { Work } from 'wanxiangli/work'
import { Rig } from './support.mjs'

// msl-020 回归：Manager 生命收尾走「空账询问 → 投递 Unknown → 实账 review」。
// 询问投递未知不是停摆：实账 review 就是「我需要干什么」的答复，消费 Ask 后
// 按普通评审推进；空账 review 仍拒绝，Parked 询问仍只等操作员答复。
test('SPEC[lifecycle-009] Manager 收尾：未知询问上的实账 review 接续，重建后一致', () => {
  const rig = new Rig('Manager', 'work-manager-unknown-ask')

  // 开立即询问（空账 review → Asked），投递确认 Unknown。
  const asked = rig.review([])
  assert.equal(asked.kind, 'Asked')
  rig.confirm(asked.effect, 'Unknown')
  assert.equal(rig.work.recover().wait, 'AwaitOperatorAnswer')

  // 空账 review 在未知询问上拒绝：不冒充已答复，也不重发询问。
  const empty = rig.call({ type: 'Review', office: 'Manager', providerRunId: 'run-1', toolCallId: 'refuse-empty', updates: [] }, 'req-refuse-empty')
  assert.equal(empty.status, 'Conflict')
  assert.equal(empty.reason, 'Question delivery is unknown')

  // 实账 review 是答复本身：写 Reviewed，消费未知询问。
  const reviewed = rig.review([{ key: 'job', value: 'do' }], { toolCallId: 'fill' }, 'req-fill')
  assert.equal(reviewed.kind, 'Reviewed')
  assert.equal(rig.work.recover().wait, 'AwaitReview')
  assert.equal(rig.work.history().at(-1).events[0].type, 'Reviewed')

  // 询问已被实账 review 化解：迟到的操作员答复不再有落点。
  const late = rig.call({ type: 'OperatorAnswer', messageId: 'answer-late' }, 'req-answer-late')
  assert.equal(late.status, 'Conflict')
  assert.equal(late.reason, 'No parked question')

  // 重建后位置与记录一致，收尾链路继续。
  rig.restored()
  const relay = rig.review([{ key: 'job', value: null }])
  assert.equal(relay.kind, 'Relayed')
  rig.confirm(relay.effect, 'Sent')
  const advanced = rig.review([])
  assert.equal(advanced.kind, 'Advanced')
  assert.equal(advanced.milestone, '收尾')
  rig.confirm(advanced.effect, 'Sent')
  const closed = rig.review([])
  assert.equal(closed.kind, 'Completed')
  rig.confirm(closed.effect, 'Requested')
  assert.equal(rig.work.inspect().milestone, '已完成')

  const revived = new Work('work-manager-unknown-ask', rig.work.records())
  assert.deepEqual(revived.inspect(), rig.work.inspect())
  assert.equal(revived.recover().wait, rig.work.recover().wait)
})

test('SPEC[lifecycle-009] Parked 询问上实账 review 仍拒绝，只等操作员答复', () => {
  const rig = new Rig('Manager', 'work-manager-parked-ask')
  const asked = rig.review([])
  assert.equal(asked.kind, 'Asked')
  rig.confirm(asked.effect, 'Parked')
  assert.equal(rig.work.recover().wait, 'AwaitOperatorAnswer')
  const filled = rig.call({ type: 'Review', office: 'Manager', providerRunId: 'run-1', toolCallId: 'refuse-filled', updates: [{ key: 'job', value: 'do' }] }, 'req-refuse-filled')
  assert.equal(filled.status, 'Conflict')
  assert.equal(filled.reason, 'Awaiting operator answer')
  rig.restored()
})
