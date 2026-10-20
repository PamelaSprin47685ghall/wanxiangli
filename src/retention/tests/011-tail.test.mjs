import test from 'node:test'
import assert from 'node:assert/strict'

import { WriterRetention } from 'wanxiangli/retention'

const retention = new WriterRetention()

const journal = observedAt => JSON.stringify({ event_type: 'JournalEnvelope', payload: { ObservedAt: observedAt } })
const cutTail = JSON.stringify({ event_type: 'ProjectionCutTail', payload: { rule: 'r' } })
const other = JSON.stringify({ event_type: 'JobRequested', payload: { ObservedAt: '2026-10-20T00:00:00.000Z' } })

/** Lines newest first, counting how many the rule actually pulls. */
const pulled = lines => {
  const seen = []
  const iterable = {
    *[Symbol.iterator]() {
      for (const line of lines) {
        seen.push(line)
        yield line
      }
    },
  }
  return { iterable, seen }
}

test('WHAT[durable-convergence-011] the newest Journal ObservedAt is the writer activity', () => {
  const at = '2026-10-19T23:59:59.999Z'
  assert.equal(retention.lastActivity([journal(at), journal('2026-10-01T00:00:00.000Z')]), Date.parse(at))
  assert.deepEqual(retention.classifyTail(journal(at)), { kind: 'observed', observedAtMs: Date.parse(at) })
})

test('WHAT[durable-convergence-011] a trailing ProjectionCutTail chain is walked past, across a segment seam', () => {
  const at = '2026-10-18T12:00:00.000Z'
  // Two cut tails at the end of the newest segment, then the previous segment's last line.
  const { iterable, seen } = pulled([cutTail, cutTail, journal(at), journal('2026-10-20T00:00:00.000Z')])
  assert.equal(retention.lastActivity(iterable), Date.parse(at))
  assert.equal(seen.length, 3, 'stops at the first verdict; never reads further back')
  assert.deepEqual(retention.classifyTail(cutTail), { kind: 'cutTail' })
})

test('WHAT[durable-convergence-011] any other tail line means no durable activity, even if an older Journal line exists', () => {
  const { iterable, seen } = pulled([other, journal('2026-10-20T00:00:00.000Z')])
  assert.equal(retention.lastActivity(iterable), null)
  assert.equal(seen.length, 1)
  assert.deepEqual(retention.classifyTail(other), { kind: 'silent' })
})

test('WHAT[durable-convergence-011] an exhausted cut-tail chain or an empty stream has no durable activity', () => {
  assert.equal(retention.lastActivity([cutTail, cutTail]), null)
  assert.equal(retention.lastActivity([]), null)
})

test('WHAT[durable-convergence-011] unusable observations are silent, never an activity instant', () => {
  const silent = [
    'not json',
    'null',
    '[]',
    JSON.stringify({ event_type: 'JournalEnvelope' }),
    JSON.stringify({ event_type: 'JournalEnvelope', payload: null }),
    JSON.stringify({ event_type: 'JournalEnvelope', payload: {} }),
    journal('not a date'),
    JSON.stringify({ event_type: 'JournalEnvelope', payload: { ObservedAt: 1760918400000 } }),
    JSON.stringify({ event_type: 42, payload: { ObservedAt: '2026-10-20T00:00:00.000Z' } }),
  ]
  for (const line of silent) {
    assert.deepEqual(retention.classifyTail(line), { kind: 'silent' }, line)
    assert.equal(retention.lastActivity([line, journal('2026-10-20T00:00:00.000Z')]), null, line)
  }
})

test('WHAT[durable-convergence-011] lastActivity refuses a non-iterable or a non-string line', () => {
  assert.throws(() => retention.lastActivity(undefined), /iterable/)
  assert.throws(() => retention.lastActivity([cutTail, 7]), /string/)
  assert.throws(() => retention.classifyTail(7), /string/)
})
