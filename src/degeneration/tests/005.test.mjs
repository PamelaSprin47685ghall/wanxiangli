import test from 'node:test'
import assert from 'node:assert/strict'
import { RequestLatencyDetector } from '../../../dist/degeneration/Degeneration.js'

const threshold = (k, total) => (total / k) * Math.log(1 / (1 - 0.99))
const feed = (detector, sessionId, count, ms) => { for (let i = 0; i < count; i += 1) detector.ObserveCompleted(sessionId, ms) }

test('SPEC[latency-006] 删失样本只增 S 不增 k，且阈值上升', () => {
  const detector = new RequestLatencyDetector()
  feed(detector, 's', 100, 1000)
  const before = detector.Snapshot('s')
  const snap = detector.ObserveCensored('s', before.ThresholdMs)
  assert.equal(snap.Seen, 101)
  assert.ok(Math.abs(snap.CompletedCount - 0.98 * before.CompletedCount) < 1e-9)
  assert.equal(snap.CensoredCount, 1)
  assert.ok(Math.abs(snap.WindowMs - (0.98 * before.WindowMs + before.ThresholdMs)) < 1e-6)
  assert.ok(Math.abs(snap.ThresholdMs - threshold(snap.CompletedCount, snap.WindowMs)) < 1e-9)
  assert.ok(snap.ThresholdMs > before.ThresholdMs)
})

test('SPEC[latency-007] 完整与删失混合时按充分统计量重算', () => {
  const detector = new RequestLatencyDetector()
  detector.ObserveCompleted('s', 2000)
  const snap = detector.ObserveCensored('s', 3000)
  // 第二次观测前已有统计整体乘 γ = 0.98
  assert.ok(Math.abs(snap.Observations - 1.98) < 1e-12)
  assert.ok(Math.abs(snap.CompletedCount - 0.98) < 1e-12)
  assert.equal(snap.CensoredCount, 1)
  assert.ok(Math.abs(snap.Alpha - 0.98) < 1e-12)
  assert.ok(Math.abs(snap.Beta - 4960) < 1e-9)
  assert.ok(Math.abs(snap.WindowMs - 4960) < 1e-9)
  assert.equal(snap.Seen, 2)
  assert.equal(snap.ThresholdMs, Number.POSITIVE_INFINITY)
})

test('SPEC[latency-008] 指数遗忘：旧观测权重按 γ^n 衰减，充分统计量与逐条参考折叠一致', () => {
  const detector = new RequestLatencyDetector()
  const samples = []
  for (let i = 0; i < 10; i += 1) samples.push(100000)
  for (let i = 0; i < 200; i += 1) samples.push(1000)
  for (const t of samples) detector.ObserveCompleted('s', t)
  let k = 0
  let total = 0
  samples.forEach((t, index) => {
    const w = 0.98 ** (samples.length - 1 - index)
    k += w
    total += w * t
  })
  const snap = detector.Snapshot('s')
  assert.ok(Math.abs(snap.CompletedCount - k) < 1e-9)
  assert.ok(Math.abs(snap.WindowMs - total) < 1e-6)
  assert.ok(Math.abs(snap.ThresholdMs - threshold(k, total)) < 1e-6)
  assert.ok(snap.Observations < 50)
  assert.equal(snap.Seen, 210)
  // 早期 10 条 100s 已基本遗忘，阈值接近全 1s 时的 1000·ln100
  const noForget = threshold(210, 10 * 100000 + 200 * 1000)
  assert.ok(noForget > 2 * snap.ThresholdMs)
})

test('SPEC[latency-018] 内存 O(1)：长序列后 Observations 不超过有效窗口，删失也随遗忘减弱', () => {
  const detector = new RequestLatencyDetector()
  feed(detector, 's', 100, 2000)
  detector.ObserveCensored('s', 600000)
  const afterCensor = detector.ThresholdMs('s')
  feed(detector, 's', 10000, 2000)
  const snap = detector.Snapshot('s')
  assert.ok(snap.Observations <= 50 + 1e-9)
  assert.ok(snap.CensoredCount < 1e-50)
  assert.ok(Math.abs(snap.MeanMs - 2000) < 1e-6)
  assert.ok(snap.ThresholdMs < afterCensor)
})
