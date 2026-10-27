import test from 'node:test'
import assert from 'node:assert/strict'
import { RequestLatencyDetector } from '../../../dist/degeneration/Degeneration.js'

const feed = (detector, sessionId, count, ms) => { for (let i = 0; i < count; i += 1) detector.ObserveCompleted(sessionId, ms) }

test('SPEC[latency-009] 极快 session 过了保护期后阈值随观测收紧到分位公式值，无地板', () => {
  const detector = new RequestLatencyDetector()
  feed(detector, 'fast', 100, 200)
  const snap = detector.Snapshot('fast')
  assert.ok(Math.abs(snap.ThresholdMs - 200 * Math.log(100)) < 1e-6)
})

test('SPEC[latency-010] Cdf 与阈值自洽：阈值处精确 0.99', () => {
  const detector = new RequestLatencyDetector()
  feed(detector, 's', 100, 1000)
  const t = detector.ThresholdMs('s')
  const cdfAtThreshold = detector.Cdf('s', t)
  assert.ok(Math.abs(cdfAtThreshold - 0.99) < 1e-12)
})

test('SPEC[latency-011] Cdf 单调递增，elapsed 0 处为 0；保护期内恒为 0', () => {
  const detector = new RequestLatencyDetector()
  detector.ObserveCompleted('s', 1000)
  assert.equal(detector.Cdf('s', 1e9), 0)
  feed(detector, 's', 99, 1000)
  detector.ObserveCensored('s', 3000)
  const t = detector.ThresholdMs('s')
  assert.equal(detector.Cdf('s', 0), 0)
  const a = detector.Cdf('s', t * 0.5)
  const b = detector.Cdf('s', t)
  const c = detector.Cdf('s', t * 1.5)
  assert.ok(a > 0 && a < b && b < c && c < 1)
})
