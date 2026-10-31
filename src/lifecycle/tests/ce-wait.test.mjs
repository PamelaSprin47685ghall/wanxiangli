// 等待步与落笔断面回归：程序位置只停等待步，Post/Reopen 落完即穿透。
// 判据：每个关键动作后 recover().wait 与快照一致，且由记录重建的实例逐点等价；
// 询问、评审与完成态重开的事实只在应落的那一跳落一次。
// 本文件只声明测试；运行归 DevOps（node --test wanxiangli/src/lifecycle/tests/ce-wait.test.mjs）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { Work } from 'wanxiangli/work'
import { Rig } from './support.mjs'

const wait = (rig) => rig.work.recover().wait

// 每个断面都从记录重建一次，钉死「重放只按事实推进」。
const hold = (rig, expected) => {
  assert.equal(wait(rig), expected)
  rig.restored()
}

test('SPEC[lifecycle-ce] Plan 旅程的等待断面与重建一致', () => {
  const rig = new Rig('Plan', 'work-wait-plan')
  hold(rig, 'AwaitReview')

  const asked = rig.review([], { toolCallId: 'w-ask' })
  assert.equal(asked.kind, 'Asked')
  hold(rig, 'ConfirmEffect')

  rig.confirm(asked.effect, 'Parked')
  hold(rig, 'AwaitOperatorAnswer')

  rig.answer('answer-w')
  hold(rig, 'AwaitReview')

  const kept = rig.review([{ key: 'need', value: 'x' }], { toolCallId: 'w-keep' })
  assert.equal(kept.kind, 'Reviewed')
  hold(rig, 'AwaitReview')

  const relayed = rig.review([{ key: 'need', value: null }], { toolCallId: 'w-clear' })
  assert.equal(relayed.kind, 'Relayed')
  hold(rig, 'ConfirmEffect')

  rig.confirm(relayed.effect, 'Sent')
  hold(rig, 'AwaitReview')

  // 接力后的 successor 首次空账评审晋级：此时不需要 originator 再建账。
  const first = rig.review([], { toolCallId: 'w-step-0' })
  assert.equal(first.kind, 'Advanced')
  assert.equal(first.milestone, '理解与路径')
  assert.equal(first.incumbencyId, relayed.successorId)
  hold(rig, 'ConfirmEffect')
  rig.confirm(first.effect, 'Sent')
  hold(rig, 'AwaitReview')

  // 后续里程碑由新的 originator 开账：问、记、清账接力，再由 successor 空账评审晋级。
  for (const [index, next] of ['流程与伪代码', '待执行'].entries()) {
    const stepAsk = rig.review([], { toolCallId: `w-ask-${index}` })
    assert.equal(stepAsk.kind, 'Asked')
    hold(rig, 'ConfirmEffect')

    rig.confirm(stepAsk.effect, 'Parked')
    hold(rig, 'AwaitOperatorAnswer')

    rig.answer(`answer-step-${index}`)
    hold(rig, 'AwaitReview')

    const stepKeep = rig.review([{ key: 'need', value: 'x' }], { toolCallId: `w-keep-${index}` })
    assert.equal(stepKeep.kind, 'Reviewed')
    hold(rig, 'AwaitReview')

    const stepRelay = rig.review([{ key: 'need', value: null }], { toolCallId: `w-clear-${index}` })
    assert.equal(stepRelay.kind, 'Relayed')
    hold(rig, 'ConfirmEffect')

    rig.send(stepRelay)
    hold(rig, 'AwaitReview')

    const advanced = rig.review([], { toolCallId: `w-step-${index + 1}` })
    assert.equal(advanced.kind, 'Advanced')
    assert.equal(advanced.milestone, next)
    assert.equal(advanced.incumbencyId, stepRelay.successorId)
    hold(rig, 'ConfirmEffect')
    rig.confirm(advanced.effect, 'Sent')
    hold(rig, next === '待执行' ? 'AwaitEmptyReview' : 'AwaitReview')
  }

  const launched = rig.review([], { toolCallId: 'w-launch' })
  assert.equal(launched.kind, 'Launched')
  hold(rig, 'ConfirmEffect')

  rig.confirm(launched.effect, 'SessionCreated', { execSessionId: 'session-w' })
  hold(rig, 'ConfirmEffect')

  rig.confirm(launched.effect, 'Admitted', { execSessionId: 'session-w' })
  hold(rig, 'AwaitEmptyReview')
})

test('SPEC[lifecycle-ce] Manager 旅程的等待断面、完成态记账与重建一致', () => {
  const rig = new Rig('Manager', 'work-wait-manager')
  hold(rig, 'AwaitReview')

  const kept = rig.review([{ key: 'job', value: 'do' }], { toolCallId: 'm-keep' })
  assert.equal(kept.kind, 'Reviewed')
  hold(rig, 'AwaitReview')

  const relayed = rig.review([{ key: 'job', value: null }], { toolCallId: 'm-clear' })
  assert.equal(relayed.kind, 'Relayed')
  hold(rig, 'ConfirmEffect')
  rig.confirm(relayed.effect, 'Sent')
  hold(rig, 'AwaitReview')

  const advanced = rig.review([], { toolCallId: 'm-step' })
  assert.equal(advanced.kind, 'Advanced')
  assert.equal(advanced.milestone, '收尾')
  hold(rig, 'ConfirmEffect')
  rig.confirm(advanced.effect, 'Sent')
  hold(rig, 'AwaitReview')

  const closed = rig.review([], { toolCallId: 'm-close' })
  assert.equal(closed.kind, 'Completed')
  hold(rig, 'ConfirmEffect')
  rig.confirm(closed.effect, 'Requested')
  hold(rig, 'AwaitOperatorMessage')

  const beforeAgent = rig.count
  const agent = rig.call({ type: 'OperatorMessage', kind: 'Agent', messageId: 'agent-w' }, 'req-agent-w')
  assert.equal(agent.status, 'Observed')
  assert.equal(agent.result.kind, 'Ignored')
  assert.equal(rig.count, beforeAgent)
  hold(rig, 'AwaitOperatorMessage')

  const beforeOperator = rig.count
  const reopened = rig.apply({ type: 'OperatorMessage', kind: 'Operator', messageId: 'operator-w' }, 'req-operator-w')
  assert.equal(reopened.kind, 'Reopened')
  assert.equal(rig.count, beforeOperator + 1)
  assert.deepEqual(rig.work.history().at(-1).events.map(event => event.type), ['IncumbencyOpened'])
  hold(rig, 'AwaitReview')
})

test('SPEC[lifecycle-ce] 未知询问只落一次 QuestionRequested，实账评审只落一次 Reviewed', () => {
  const rig = new Rig('Plan', 'work-wait-unknown')
  const asked = rig.review([], { toolCallId: 'u-ask' })
  assert.equal(asked.kind, 'Asked')
  rig.confirm(asked.effect, 'Unknown')
  hold(rig, 'AwaitOperatorAnswer')

  const reviewed = rig.review([{ key: 'need', value: 'x' }], { toolCallId: 'u-fill' })
  assert.equal(reviewed.kind, 'Reviewed')
  hold(rig, 'AwaitReview')

  const events = rig.work.history().flatMap(record => record.events)
  assert.equal(events.filter(event => event.type === 'QuestionRequested').length, 1)
  assert.equal(events.filter(event => event.type === 'Reviewed').length, 1)
})
