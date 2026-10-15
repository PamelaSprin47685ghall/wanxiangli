import test from 'node:test'
import assert from 'node:assert/strict'
import { Time } from '../../../dist/time/Time.js'

const NOW = '2026-10-15T00:00:00.000Z'

test('WHAT[TIME-CAPABILITY-002] remaining and expiry come from the typed deadline, not raw comparisons', () => {
  const deadline = Time.deadlineCreate(NOW, 1000)
  assert.equal(Time.deadlineRemainingMs('2026-10-15T00:00:00.400Z', deadline), 600)
  assert.equal(Time.deadlineIsExpired('2026-10-15T00:00:00.999Z', deadline), false)
  assert.equal(Time.deadlineIsExpired('2026-10-15T00:00:01.000Z', deadline), true)
  assert.equal(Time.deadlineNextWaitMs('2026-10-14T23:59:59.500Z', deadline), 1500)
})

test('WHAT[TIME-CAPABILITY-002] remaining never goes negative and expired deadlines wait zero', () => {
  const deadline = Time.deadlineCreate(NOW, 1000)
  assert.equal(Time.deadlineRemainingMs('2026-10-15T00:00:05.000Z', deadline), 0)
  assert.equal(Time.deadlineNextWaitMs('2026-10-15T00:00:05.000Z', deadline), 0)
  assert.equal(Time.deadlineIsExpired('2026-10-15T00:00:05.000Z', deadline), true)
})

test('WHAT[TIME-CAPABILITY-002] an extreme budget is clamped instead of overflowing', () => {
  const deadline = Time.deadlineCreate(NOW, 1e15)
  assert.equal(Time.deadlineIsExpired(NOW, deadline), false)
  assert.ok(Number.isSafeInteger(Time.deadlineRemainingMs(NOW, deadline)))
})

test('WHAT[TIME-CAPABILITY-002] next wait is capped at the JS timer ceiling', () => {
  const deadline = Time.deadlineCreate(NOW, 1e15)
  assert.equal(Time.maxTimerWaitMs, 2147483647)
  assert.equal(Time.deadlineNextWaitMs(NOW, deadline), Time.maxTimerWaitMs)
})

test('WHAT[TIME-CAPABILITY-002] a negative budget is an expired deadline, not an exception', () => {
  const deadline = Time.deadlineCreate(NOW, -1000)
  assert.equal(Time.deadlineIsExpired(NOW, deadline), true)
  assert.equal(Time.deadlineRemainingMs(NOW, deadline), 0)
  assert.equal(Time.deadlineNextWaitMs(NOW, deadline), 0)
})

test('WHAT[TIME-CAPABILITY-002] timezone representation does not change the result', () => {
  const utc = Time.deadlineCreate('2026-10-15T00:00:00.000Z', 1000)
  const shifted = Time.deadlineCreate('2026-10-15T02:00:00.000+02:00', 1000)
  assert.equal(Time.deadlineRemainingMs('2026-10-15T00:00:00.500Z', utc), 500)
  assert.equal(Time.deadlineRemainingMs('2026-10-15T02:00:00.500+02:00', shifted), 500)
  assert.equal(Time.deadlineIsExpired('2026-10-15T00:00:01.000Z', utc), Time.deadlineIsExpired('2026-10-15T02:00:01.000+02:00', shifted))
})
