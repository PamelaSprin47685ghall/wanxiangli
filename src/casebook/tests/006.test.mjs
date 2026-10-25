import test from 'node:test'
import assert from 'node:assert/strict'

import { bookkeeperStaging } from 'wanxiangli/casebook'

const MISSING = 'todowrite-for-bookkeeper: no staged transaction'
const NOT_WRITTEN = 'the staged transaction was not written by this completion'

const assertOk = (result, value, label) => {
  assert.equal(result.tag, 0, label + ' 应为 Ok')
  assert.deepEqual(result.fields[0], value, label)
}

const assertError = (result, message, label) => {
  assert.equal(result.tag, 1, label + ' 应为 Error')
  assert.equal(result.fields[0], message, label + ' 错误文本必须逐字一致')
}

test('WHAT[knowledge-reuse-006] 正常流程：begin、snapshot、apply、take 原子变换', () => {
  const staging = bookkeeperStaging
  staging.beginTransaction('t-normal', '旧问', '旧答')
  assertOk(staging.snapshot('t-normal'), ['旧问', '旧答'], 'snapshot 读回初始 Q/A')
  assertOk(staging.apply('t-normal', '新问', undefined), undefined, 'apply 只补 question')
  assertOk(staging.snapshot('t-normal'), ['新问', '旧答'], 'answer 保留旧值')
  assertOk(staging.take('t-normal'), ['新问', '旧答'], 'take 取出本次写入的 Case')
  assertError(staging.snapshot('t-normal'), MISSING, '成功 take 后事务已删除')
})

test('WHAT[knowledge-reuse-006] 事务隔离：不同 txId 各自成槽互不干扰', () => {
  const staging = bookkeeperStaging
  staging.beginTransaction('t-a', 'QA', 'AA')
  staging.beginTransaction('t-b', 'QB', 'AB')
  staging.apply('t-a', 'QA2', 'AA2')
  assertOk(staging.snapshot('t-b'), ['QB', 'AB'], 't-b 不受 t-a 写入影响')
  assert.equal(staging.touched('t-b'), false, 't-b 未被写过')
  assertOk(staging.take('t-a'), ['QA2', 'AA2'], 't-a 独立取出')
  assertOk(staging.snapshot('t-b'), ['QB', 'AB'], 't-a 的 take 不删除 t-b')
  staging.abort('t-a')
  staging.abort('t-b')
})

test('WHAT[knowledge-reuse-006] begin 覆盖：重开同名事务把 touched 归位 false', () => {
  const staging = bookkeeperStaging
  staging.beginTransaction('t-reopen', 'Q1', 'A1')
  staging.apply('t-reopen', 'Q1x', 'A1x')
  assert.equal(staging.touched('t-reopen'), true, '覆盖前已写过')
  staging.beginTransaction('t-reopen', 'Q2', 'A2')
  assertOk(staging.snapshot('t-reopen'), ['Q2', 'A2'], 'begin 直接覆盖旧槽')
  assert.equal(staging.touched('t-reopen'), false, '覆盖后回到未写状态')
  assertError(staging.take('t-reopen'), NOT_WRITTEN, '初始 Q/A 不能冒充本次交付（LC-029）')
  staging.abort('t-reopen')
})

test('WHAT[knowledge-reuse-006] 未写 take 被拒绝且事务保留，补写后可取出', () => {
  const staging = bookkeeperStaging
  staging.beginTransaction('t-untouched', 'Q', 'A')
  assertError(staging.take('t-untouched'), NOT_WRITTEN, '未写过的 take 拒绝')
  assertOk(staging.snapshot('t-untouched'), ['Q', 'A'], '拒绝的 take 不删除事务')
  staging.apply('t-untouched', undefined, undefined)
  assertOk(staging.take('t-untouched'), ['Q', 'A'], '全空 apply 也算本次写入，且原值保留')
})

test('WHAT[knowledge-reuse-006] 缺失事务：逐字错误，touched 为 false，abort 成功', () => {
  const staging = bookkeeperStaging
  assertError(staging.snapshot('t-ghost'), MISSING, '缺失 snapshot')
  assertError(staging.apply('t-ghost', 'Q', 'A'), MISSING, '缺失 apply')
  assertError(staging.take('t-ghost'), MISSING, '缺失 take')
  assert.equal(staging.touched('t-ghost'), false, '缺失 touched 为 false')
  staging.abort('t-ghost')
})

test('WHAT[knowledge-reuse-006] abort 幂等：删除后再 abort 不报错', () => {
  const staging = bookkeeperStaging
  staging.beginTransaction('t-abort', 'Q', 'A')
  staging.apply('t-abort', 'Q2', 'A2')
  staging.abort('t-abort')
  staging.abort('t-abort')
  assertError(staging.snapshot('t-abort'), MISSING, 'abort 后槽已消失')
  assert.equal(staging.touched('t-abort'), false)
})

test('WHAT[knowledge-reuse-006] apply(undefined, undefined) 保留原有 Q/A 且 touched 设为 true', () => {
  const staging = bookkeeperStaging
  staging.beginTransaction('t-null-preserve', '原问题', '原回答')
  assert.equal(staging.touched('t-null-preserve'), false)
  assertOk(staging.apply('t-null-preserve', undefined, undefined), undefined, 'apply 成功返回')
  assert.equal(staging.touched('t-null-preserve'), true, 'touched 变为 true')
  assertOk(staging.snapshot('t-null-preserve'), ['原问题', '原回答'], '原有 Q/A 严格保留不变')
  assertOk(staging.take('t-null-preserve'), ['原问题', '原回答'], 'touched 为 true 可成功 take 出原值')
  staging.abort('t-null-preserve')
})
