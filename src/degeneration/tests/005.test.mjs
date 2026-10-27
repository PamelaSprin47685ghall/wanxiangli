import test from 'node:test'
import assert from 'node:assert/strict'
import { RequestLatencyDetector } from '../../../dist/degeneration/Degeneration.js'

const threshold = (alpha, beta) => (beta / alpha) * Math.log(1 / (1 - 0.99))

test('SPEC[latency-006] 删失样本只增 Beta 不增 Alpha，且阈值上升', () => {
  const detector = new RequestLatencyDetector()
  const cold = detector.ThresholdMs('s')
  const snap = detector.ObserveCensored('s', cold)
  assert.equal(snap.Observations, 1)
  assert.equal(snap.CompletedCount, 0)
  assert.equal(snap.CensoredCount, 1)
  assert.equal(snap.Alpha, 5)
  assert.equal(snap.Beta, 25000 + cold)
  assert.equal(snap.MeanMs, (25000 + cold) / 5)
  assert.ok(Math.abs(snap.ThresholdMs - threshold(5, 25000 + cold)) < 1e-9)
  assert.ok(snap.ThresholdMs > cold)
  // 数量级参考：≈ 44242ms
  assert.ok(snap.ThresholdMs > 40000 && snap.ThresholdMs < 48000)
})

test('SPEC[latency-007] 完整与删失混合时后验仍从先验重算', () => {
  const detector = new RequestLatencyDetector()
  detector.ObserveCompleted('s', 2000)
  const snap = detector.ObserveCensored('s', 3000)
  assert.equal(snap.Observations, 2)
  assert.equal(snap.CompletedCount, 1)
  assert.equal(snap.CensoredCount, 1)
  assert.equal(snap.Alpha, 6)
  assert.equal(snap.Beta, 30000)
  assert.equal(snap.WindowMs, 5000)
})

test('SPEC[latency-008] 50 条窗口淘汰最早观测', () => {
  const detector = new RequestLatencyDetector()
  // 前 10 条 100s：若窗口未淘汰，β 会是 25000 + 1000000 + 50000 = 1075000
  for (let i = 0; i < 10; i += 1) detector.ObserveCompleted('s', 100000)
  // 后 50 条 1s：窗口生效时这 50 条就是全部统计
  for (let i = 0; i < 50; i += 1) detector.ObserveCompleted('s', 1000)
  const snap = detector.Snapshot('s')
  assert.equal(snap.Observations, 50)
  assert.equal(snap.CompletedCount, 50)
  assert.equal(snap.WindowMs, 50000)
  assert.equal(snap.Alpha, 55)
  assert.equal(snap.Beta, 75000)
  assert.ok(Math.abs(snap.ThresholdMs - threshold(55, 75000)) < 1e-9)
  // 数量级参考：≈ 6280ms；窗口未生效时会明显更高（≈ 76161ms），用差值断言窗口生效
  assert.ok(snap.ThresholdMs > 5000 && snap.ThresholdMs < 7000)
  assert.ok(threshold(65, 1075000) > 60000)
})
