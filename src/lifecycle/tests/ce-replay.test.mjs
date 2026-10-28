// CE 重放等价回归：程序位置由事实重放持有，不按 phase 跳转。
// 判据：同一事实前缀 + 相同命令序列 ⇒ 相同后续记录、相同快照与恢复视图。
// 无论实例连续执行还是经 Work(workId, records) 重建，下一步都一致。
// 本文件只声明测试；运行归 DevOps（node --test wanxiangli/src/lifecycle/tests/ce-replay.test.mjs）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { Work } from 'wanxiangli/work'
import { Rig } from './support.mjs'

const effects = {}

// 实账增补后清空接力并转出：覆盖 Originator 与 Working 两个重入点。
const keepRound = (id) => rig => {
  const kept = rig.review([{ key: id, value: id }], { toolCallId: id + '-keep' }, 'req-' + id + '-keep')
  assert.equal(kept.kind, 'Reviewed')
  const relayed = rig.review([{ key: id, value: null }], { toolCallId: id + '-clear' }, 'req-' + id + '-clear')
  assert.equal(relayed.kind, 'Relayed')
  effects[id] = relayed.effect
  rig.confirm(relayed.effect, 'Sent', {}, 'req-' + id + '-sent')
}

// 接任首轮空账：只晋级，不新建任期（SuccessorFirst 重入点）。
const step = (id) => rig => {
  const advanced = rig.review([], { toolCallId: id + '-step' }, 'req-' + id + '-step')
  assert.equal(advanced.kind, 'Advanced')
  effects[id] = advanced.effect
  rig.confirm(advanced.effect, 'Sent', {}, 'req-' + id + '-step-sent')
}

// 空账询问并等待答复（Originator 循环与 AwaitingAnswer 重入点）。
const ask = (id) => rig => {
  const asked = rig.review([], { toolCallId: id }, 'req-' + id)
  assert.equal(asked.kind, 'Asked')
  rig.confirm(asked.effect, 'Parked', {}, 'req-' + id + '-parked')
  rig.apply({ type: 'OperatorAnswer', messageId: 'answer-' + id }, 'req-' + id + '-answer')
}

function proveReplay(office, workId, prefix, tail) {
  const direct = new Rig(office, workId)
  for (const run of prefix) run(direct)
  const fork = new Rig(office, workId)
  for (const run of prefix) run(fork)
  const revived = new Rig(office, workId)
  revived.work = new Work(workId, fork.work.records())
  for (const run of tail) run(direct)
  for (const run of tail) run(revived)
  assert.deepEqual(revived.work.records(), direct.work.records())
  assert.deepEqual(revived.work.inspect(), direct.work.inspect())
  assert.deepEqual(revived.work.recover(), direct.work.recover())
  return { direct, revived }
}

test('SPEC[lifecycle-ce] 同一事实前缀重放后，接力、晋级、启动与未知确认产生同一记录', () => {
  const prefix = [keepRound('need'), step('need'), keepRound('path'), step('path'), keepRound('wire'), step('wire')]
  const tail = [
    rig => { const launched = rig.review([], { toolCallId: 'create-1' }, 'req-create-1'); effects.c1 = launched.effect },
    rig => rig.confirm(effects.c1, 'Unknown', {}, 'req-c1-unknown'),
    rig => { const again = rig.review([], { toolCallId: 'create-2' }, 'req-create-2'); effects.c2 = again.effect },
    rig => rig.confirm(effects.c2, 'SessionCreated', { execSessionId: 's-2' }, 'req-c2-bound'),
    rig => rig.confirm(effects.c2, 'Admitted', { execSessionId: 's-2' }, 'req-c2-admitted'),
  ]
  const { direct, revived } = proveReplay('Plan', 'work-a', prefix, tail)
  const launches = direct.work.inspect().launches
  assert.equal(launches.length, 2)
  assert.equal(launches[0].status, 'Unknown')
  assert.equal(launches[1].status, 'Admitted')
  assert.equal(revived.work.recover().effect, null)
  assert.equal(direct.work.inspect().milestone, '待执行')
})

test('SPEC[lifecycle-ce] 空账询问循环与实账评审：重建后任期推进一致', () => {
  const prefix = [ask('first'), ask('second')]
  const tail = [
    rig => rig.review([{ key: 'need', value: 'x' }], { toolCallId: 'fill' }, 'req-fill'),
    rig => { const relayed = rig.review([{ key: 'need', value: null }], { toolCallId: 'clear' }, 'req-clear'); effects.r1 = relayed.effect },
    rig => rig.confirm(effects.r1, 'Sent', {}, 'req-r1-sent'),
    rig => { const advanced = rig.review([], { toolCallId: 'step' }, 'req-step'); effects.a1 = advanced.effect },
    rig => rig.confirm(effects.a1, 'Sent', {}, 'req-a1-sent'),
  ]
  const { direct } = proveReplay('Plan', 'work-ask', prefix, tail)
  assert.equal(direct.work.inspect().milestone, '理解与路径')
})

// 询问确认 Unknown：保留未知，不冒充已 Parked，不自动重发；Review 安全拒绝，答复到达才化解未知。
test('SPEC[lifecycle-ce] 询问确认 Unknown：等待可观察、Review 拒绝不抛异常、答复接续重放一致', () => {
  const prefix = [
    rig => { const asked = rig.review([], { toolCallId: 'u-ask' }, 'req-u-ask'); assert.equal(asked.kind, 'Asked'); effects.uAsk = asked.effect },
    rig => rig.confirm(effects.uAsk, 'Unknown', {}, 'req-u-unknown'),
  ]
  const tail = [
    rig => {
      const snap = rig.work.inspect()
      assert.equal(snap.phase, 'Originator')
      assert.equal(snap.pending, null)
      const rec = rig.work.recover()
      assert.equal(rec.wait, 'AwaitOperatorAnswer')
      assert.equal(rec.next, 'OperatorAnswer')
      assert.equal(rec.effect, null)
    },
    rig => {
      const before = rig.count
      const emptyReview = rig.call({ type: 'Review', office: 'Plan', providerRunId: 'run-1', toolCallId: 'u-refuse-empty', updates: [] }, 'req-u-refuse-empty')
      assert.equal(emptyReview.status, 'Conflict')
      assert.equal(emptyReview.reason, 'Question delivery is unknown')
      const filledReview = rig.call({ type: 'Review', office: 'Plan', providerRunId: 'run-1', toolCallId: 'u-refuse-filled', updates: [{ key: 'need', value: 'x' }] }, 'req-u-refuse-filled')
      assert.equal(filledReview.status, 'Conflict')
      assert.equal(filledReview.reason, 'Question delivery is unknown')
      assert.equal(rig.count, before)
    },
    rig => {
      const before = rig.count
      const parkedLate = rig.call({ type: 'Confirm', effectId: effects.uAsk.id, outcome: 'Parked' }, 'req-u-parked-late')
      assert.equal(parkedLate.status, 'Conflict')
      assert.equal(parkedLate.reason, 'Confirmation does not match the effect')
      const unknownAgain = rig.call({ type: 'Confirm', effectId: effects.uAsk.id, outcome: 'Unknown' }, 'req-u-unknown-again')
      assert.equal(unknownAgain.status, 'Observed')
      assert.equal(unknownAgain.result.outcome, 'Unknown')
      assert.equal(rig.count, before)
    },
    rig => {
      const answered = rig.apply({ type: 'OperatorAnswer', messageId: 'answer-unknown' }, 'req-answer-unknown')
      assert.equal(answered.kind, 'Answered')
      assert.equal(rig.work.recover().wait, 'AwaitReview')
      const history = rig.work.history()
      assert.equal(history.at(-2).events[0].type, 'EffectConfirmed')
      assert.equal(history.at(-2).events[0].outcome, 'Unknown')
      assert.equal(history.at(-1).events[0].type, 'OperatorAnswered')
    },
    rig => {
      const before = rig.count
      const dup = rig.call({ type: 'OperatorAnswer', messageId: 'answer-unknown-dup' }, 'req-answer-unknown-dup')
      assert.equal(dup.status, 'Conflict')
      assert.equal(dup.reason, 'No parked question')
      assert.equal(rig.count, before)
    },
    rig => { const kept = rig.review([{ key: 'need', value: 'x' }], { toolCallId: 'u-keep' }, 'req-u-keep'); assert.equal(kept.kind, 'Reviewed') },
    rig => { const relayed = rig.review([{ key: 'need', value: null }], { toolCallId: 'u-clear' }, 'req-u-clear'); assert.equal(relayed.kind, 'Relayed'); effects.uRelay = relayed.effect },
    rig => rig.confirm(effects.uRelay, 'Sent', {}, 'req-u-relay-sent'),
    rig => { const advanced = rig.review([], { toolCallId: 'u-step' }, 'req-u-step'); assert.equal(advanced.kind, 'Advanced'); effects.uAdvance = advanced.effect },
    rig => rig.confirm(effects.uAdvance, 'Sent', {}, 'req-u-advance-sent'),
  ]
  const { direct } = proveReplay('Plan', 'work-ask-unknown', prefix, tail)
  assert.equal(direct.work.inspect().milestone, '理解与路径')
  assert.equal(direct.work.records().length, 8)
})

test('SPEC[lifecycle-ce] 接任首轮重入：重建后空账晋级与实账回评审产生同一记录', () => {
  const prefix = [keepRound('need'), step('need'), keepRound('path')]
  const tail = [step('path'), keepRound('wire'), step('wire')]
  const { direct } = proveReplay('Plan', 'work-successor', prefix, tail)
  assert.equal(direct.work.inspect().milestone, '待执行')
})

test('SPEC[lifecycle-ce] 收尾、结案与操作员重开：重建后一致，未知保留不重发', () => {
  const prefix = [
    rig => rig.review([{ key: 'job', value: 'do' }], { toolCallId: 'job-keep' }, 'req-job-keep'),
    rig => { const relayed = rig.review([{ key: 'job', value: null }], { toolCallId: 'job-clear' }, 'req-job-clear'); effects.m1 = relayed.effect },
    rig => rig.confirm(effects.m1, 'Sent', {}, 'req-m1-sent'),
  ]
  const tail = [
    rig => { const advanced = rig.review([], { toolCallId: 'exec-step' }, 'req-exec-step'); assert.equal(advanced.milestone, '收尾'); effects.m2 = advanced.effect },
    rig => rig.confirm(effects.m2, 'Sent', {}, 'req-m2-sent'),
    rig => { const blocked = rig.call({ type: 'Review', office: 'Manager', providerRunId: 'run-1', toolCallId: 'blocked', updates: [], blockers: ['lock'] }, 'req-blocked'); assert.equal(blocked.result.kind, 'Blocked') },
    rig => rig.review([{ key: 'left', value: 'note' }], { toolCallId: 'left-keep' }, 'req-left-keep'),
    rig => { const closed = rig.review([{ key: 'left', value: null }], { toolCallId: 'left-clear' }, 'req-left-clear'); assert.equal(closed.kind, 'Completed'); effects.stop = closed.effect },
    rig => rig.confirm(effects.stop, 'Unknown', {}, 'req-stop-unknown'),
    rig => { const late = rig.call({ type: 'Review', office: 'Manager', providerRunId: 'run-1', toolCallId: 'late', updates: [] }, 'req-late'); assert.equal(late.status, 'Conflict'); assert.equal(late.reason, 'Work is complete') },
    rig => rig.apply({ type: 'OperatorMessage', kind: 'Operator', messageId: 'operator-reopen' }, 'req-reopen'),
  ]
  const { direct } = proveReplay('Manager', 'work-manager', prefix, tail)
  assert.equal(direct.work.inspect().milestone, '执行')
  assert.equal(direct.work.inspect().active.origin, 'Originator')
})

test('SPEC[lifecycle-ce] 绑定会话后重建：Admitted、Unknown、NotStarted 有效确认一致，错配仍拒绝', () => {
  const prefix = [
    keepRound('bound-need'), step('bound-need'),
    keepRound('bound-path'), step('bound-path'),
    keepRound('bound-wire'), step('bound-wire'),
    rig => { const launched = rig.review([], { toolCallId: 'bound-create-1' }, 'req-bound-create-1'); effects.cB1 = launched.effect },
    rig => rig.confirm(effects.cB1, 'SessionCreated', { execSessionId: 'session-bound' }, 'req-bound-session'),
  ]
  const tail = [
    rig => {
      const state = rig.work.inspect()
      assert.equal(state.launches.length, 1)
      assert.equal(state.launches[0].status, 'Send')
      assert.equal(state.launches[0].execSessionId, 'session-bound')
      assert.equal(rig.work.recover().wait, 'ConfirmEffect')
      assert.equal(rig.work.recover().effect.kind, 'Launch')
      assert.equal(rig.work.recover().effect.phase, 'Send')
    },
    rig => rig.confirm(effects.cB1, 'Admitted', { execSessionId: 'session-bound' }, 'req-cb1-admitted'),
    rig => { const second = rig.review([], { toolCallId: 'bound-create-2' }, 'req-bound-create-2'); effects.cB2 = second.effect },
    rig => rig.confirm(effects.cB2, 'Unknown', {}, 'req-cb2-unknown'),
    rig => { const third = rig.review([], { toolCallId: 'bound-create-3' }, 'req-bound-create-3'); effects.cB3 = third.effect },
    rig => rig.confirm(effects.cB3, 'SessionCreated', { execSessionId: 'session-other' }, 'req-cb3-session'),
    rig => rig.confirm(effects.cB3, 'NotStarted', { reason: 'refused' }, 'req-cb3-rejected'),
    rig => { const fourth = rig.review([], { toolCallId: 'bound-create-4' }, 'req-bound-create-4'); effects.cB4 = fourth.effect },
    rig => rig.confirm(effects.cB4, 'SessionCreated', { execSessionId: 'session-four' }, 'req-cb4-session'),
    rig => {
      const before = rig.count
      const wrong = rig.call({ type: 'Confirm', effectId: effects.cB4.id, outcome: 'Admitted', execSessionId: 'session-five' }, 'req-cb4-wrong')
      assert.equal(wrong.status, 'Conflict')
      assert.equal(wrong.reason, 'Confirmation does not match the effect')
      assert.equal(rig.count, before)
    },
    rig => rig.confirm(effects.cB4, 'Admitted', { execSessionId: 'session-four' }, 'req-cb4-admitted'),
  ]
  const { direct } = proveReplay('Plan', 'work-bound-rebuild', prefix, tail)
  const launches = direct.work.inspect().launches
  assert.equal(launches.length, 4)
  assert.equal(launches[0].status, 'Admitted')
  assert.equal(launches[1].status, 'Unknown')
  assert.equal(launches[2].status, 'Rejected')
  assert.equal(launches[3].status, 'Admitted')
  assert.equal(direct.work.recover().effect, null)
  assert.equal(direct.work.inspect().milestone, '待执行')
})

test('SPEC[lifecycle-ce] 结案后重建：Stop Requested 落盘后再确认 Observed，迟到与错配不追加', () => {
  const prefix = [
    rig => rig.review([{ key: 'job', value: 'do' }], { toolCallId: 'd-keep' }, 'req-d-keep'),
    rig => { const relayed = rig.review([{ key: 'job', value: null }], { toolCallId: 'd-clear' }, 'req-d-clear'); assert.equal(relayed.kind, 'Relayed'); effects.dR1 = relayed.effect },
    rig => rig.confirm(effects.dR1, 'Sent', {}, 'req-dr1-sent'),
    rig => { const advanced = rig.review([], { toolCallId: 'd-step' }, 'req-d-step'); assert.equal(advanced.milestone, '收尾'); effects.dS2 = advanced.effect },
    rig => rig.confirm(effects.dS2, 'Sent', {}, 'req-ds2-sent'),
    rig => { const closed = rig.review([], { toolCallId: 'd-close' }, 'req-d-close'); assert.equal(closed.kind, 'Completed'); effects.dStop = closed.effect },
    rig => rig.confirm(effects.dStop, 'Requested', {}, 'req-dstop-requested'),
  ]
  const tail = [
    rig => {
      assert.equal(rig.work.inspect().completed, true)
      assert.equal(rig.work.recover().wait, 'AwaitOperatorMessage')
      assert.equal(rig.work.recover().effect, null)
    },
    rig => rig.confirm(effects.dStop, 'Observed', {}, 'req-dstop-observed'),
    rig => {
      const before = rig.count
      const late = rig.call({ type: 'Confirm', effectId: effects.dStop.id, outcome: 'Observed' }, 'req-dstop-late')
      assert.equal(late.status, 'Observed')
      assert.equal(late.result.outcome, 'Observed')
      assert.equal(rig.count, before)
    },
    rig => {
      const wrong = rig.call({ type: 'Confirm', effectId: effects.dStop.id, outcome: 'Requested' }, 'req-dstop-wrong')
      assert.equal(wrong.status, 'Conflict')
      assert.equal(wrong.reason, 'Confirmation does not match the effect')
    },
    rig => {
      assert.equal(rig.work.recover().effect, null)
      assert.equal(rig.work.recover().wait, 'AwaitOperatorMessage')
    },
  ]
  const { direct } = proveReplay('Manager', 'work-stop-rebuild', prefix, tail)
  assert.equal(direct.work.inspect().milestone, '已完成')
  assert.equal(direct.work.inspect().completed, true)
})

test('SPEC[lifecycle-ce] 操作员重开后继续评审：空账询问、实账、接力、晋级与再次结案一致', () => {
  const prefix = [
    rig => rig.review([{ key: 'job', value: 'do' }], { toolCallId: 'a-keep' }, 'req-a-keep'),
    rig => { const relayed = rig.review([{ key: 'job', value: null }], { toolCallId: 'a-clear' }, 'req-a-clear'); assert.equal(relayed.kind, 'Relayed'); effects.aR1 = relayed.effect },
    rig => rig.confirm(effects.aR1, 'Sent', {}, 'req-ar1-sent'),
    rig => { const advanced = rig.review([], { toolCallId: 'a-step' }, 'req-a-step'); assert.equal(advanced.milestone, '收尾'); effects.aS2 = advanced.effect },
    rig => rig.confirm(effects.aS2, 'Sent', {}, 'req-as2-sent'),
    rig => { const closed = rig.review([], { toolCallId: 'a-close' }, 'req-a-close'); assert.equal(closed.kind, 'Completed'); effects.aStop = closed.effect },
    rig => rig.confirm(effects.aStop, 'Requested', {}, 'req-astop-requested'),
  ]
  const tail = [
    rig => { const reopened = rig.apply({ type: 'OperatorMessage', kind: 'Operator', messageId: 'operator-continue' }, 'req-a-reopen'); assert.equal(reopened.kind, 'Reopened'); assert.equal(reopened.milestone, '执行'); effects.aReopen = reopened },
    rig => {
      const asked = rig.review([], { toolCallId: 'a-reopen-ask' }, 'req-a-reopen-ask')
      assert.equal(asked.kind, 'Asked')
      assert.equal(asked.incumbencyId, effects.aReopen.incumbencyId)
      assert.equal(asked.effect.kind, 'Ask')
      effects.aAsk = asked.effect
    },
    rig => rig.confirm(effects.aAsk, 'Parked', {}, 'req-a-ask-parked'),
    rig => rig.apply({ type: 'OperatorAnswer', messageId: 'answer-continue' }, 'req-a-answer'),
    rig => {
      const reviewed = rig.review([{ key: 'redo', value: 'again' }], { toolCallId: 'a-redo-keep' }, 'req-a-redo-keep')
      assert.equal(reviewed.kind, 'Reviewed')
      assert.equal(reviewed.incumbencyId, effects.aReopen.incumbencyId)
      assert.deepEqual(rig.work.history().at(-1).events.map(event => event.type), ['Reviewed'])
    },
    rig => { const relayed = rig.review([{ key: 'redo', value: null }], { toolCallId: 'a-redo-clear' }, 'req-a-redo-clear'); assert.equal(relayed.kind, 'Relayed'); effects.aR2 = relayed.effect },
    rig => rig.confirm(effects.aR2, 'Sent', {}, 'req-ar2-sent'),
    rig => { const advanced = rig.review([], { toolCallId: 'a-redo-step' }, 'req-a-redo-step'); assert.equal(advanced.kind, 'Advanced'); assert.equal(advanced.milestone, '收尾'); effects.aS4 = advanced.effect },
    rig => rig.confirm(effects.aS4, 'Sent', {}, 'req-as4-sent'),
    rig => { const closed = rig.review([], { toolCallId: 'a-reclose' }, 'req-a-reclose'); assert.equal(closed.kind, 'Completed'); effects.aStop2 = closed.effect },
    rig => rig.confirm(effects.aStop2, 'Requested', {}, 'req-astop2-requested'),
    rig => rig.confirm(effects.aStop2, 'Observed', {}, 'req-astop2-observed'),
  ]
  const { direct } = proveReplay('Manager', 'work-reopen-continue', prefix, tail)
  assert.equal(direct.work.inspect().milestone, '已完成')
  assert.equal(direct.work.inspect().completed, true)
})
