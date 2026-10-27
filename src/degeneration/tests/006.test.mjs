import test from 'node:test'
import assert from 'node:assert/strict'
import { RequestLatencyDetector } from '../../../dist/degeneration/Degeneration.js'

const threshold = (alpha, beta) => (beta / alpha) * Math.log(1 / (1 - 0.99))

// 极快 session：50 条 200ms → k = 50·(1−0.98^50) ≈ 31.8，β/α ≈ (25000+200k)/(5+k)，阈值 ≈ 3.5s。无地板，阈值直接随观测收紧。
test('SPEC[latency-009] 极快 session 的阈值随观测收紧到分位公式值', () => {
  const detector = new RequestLatencyDetector()
  const cold = detector.ThresholdMs('fast')
  for (let i = 0; i < 50; i += 1) detector.ObserveCompleted('fast', 200)
  const snap = detector.Snapshot('fast')
  const k = 50 * (1 - 0.98 ** 50)
  assert.ok(Math.abs(snap.Alpha - (5 + k)) < 1e-9)
  assert.ok(Math.abs(snap.Beta - (25000 + 200 * k)) < 1e-6)
  assert.ok(Math.abs(snap.ThresholdMs - threshold(5 + k, 25000 + 200 * k)) < 1e-6)
  // 数量级参考：≈ 3.5s，远低于冷启动 ≈ 23s
  assert.ok(snap.ThresholdMs > 2000 && snap.ThresholdMs < 4500)
  assert.ok(snap.ThresholdMs < cold / 4)
})

test('SPEC[latency-010] Cdf 与阈值自浃：阈值处精确 0.99', () => {
  const detector = new RequestLatencyDetector()
  detector.ObserveCompleted('s', 1000)
  const t = detector.ThresholdMs('s')
  const cdfAtThreshold = detector.Cdf('s', t)
  assert.ok(cdfAtThreshold >= 0.99)
  assert.ok(Math.abs(cdfAtThreshold - 0.99) < 1e-12)
})

test('SPEC[latency-011] Cdf 单调递增，elapsed 0 处为 0', () => {
  const detector = new RequestLatencyDetector()
  detector.ObserveCompleted('s', 1000)
  detector.ObserveCensored('s', 3000)
  const t = detector.ThresholdMs('s')
  assert.equal(detector.Cdf('s', 0), 0)
  const a = detector.Cdf('s', t * 0.5)
  const b = detector.Cdf('s', t)
  const c = detector.Cdf('s', t * 1.5)
  assert.ok(a > 0 && a < b && b < c && c < 1)
})
