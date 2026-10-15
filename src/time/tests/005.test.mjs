import test from 'node:test'
import assert from 'node:assert/strict'
import { Time } from '../../../dist/time/Time.js'

const NOW = '2026-10-15T00:00:00.000Z'

test('WHAT[TIME-CAPABILITY-005] deadline computation is a pure replay of its inputs', () => {
  const deadline = Time.deadlineCreate(NOW, 5000)
  for (let i = 0; i < 3; i++) {
    assert.equal(Time.deadlineRemainingMs('2026-10-15T00:00:03.000Z', deadline), 2000)
    assert.equal(Time.deadlineIsExpired('2026-10-15T00:00:03.000Z', deadline), false)
    assert.equal(Time.deadlineNextWaitMs('2026-10-15T00:00:03.000Z', deadline), 2000)
  }
})

test('WHAT[TIME-CAPABILITY-005] constructing and reading a deadline has no side effects', async () => {
  const before = Date.now()
  const deadline = Time.deadlineCreate(NOW, 100)
  Time.deadlineRemainingMs(NOW, deadline)
  Time.deadlineIsExpired(NOW, deadline)
  Time.deadlineNextWaitMs(NOW, deadline)
  // 时间值只是输入：这里没有任何等待、回调或外部效果被制造。
  assert.ok(Date.now() - before < 50)
})
