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
  // 第二次观测前已有统计整体乘 γ = 0.98
  assert.ok(Math.abs(snap.Observations - 1.98) < 1e-12)
  assert.ok(Math.abs(snap.CompletedCount - 0.98) < 1e-12)
  assert.equal(snap.CensoredCount, 1)
  assert.ok(Math.abs(snap.Alpha - 5.98) < 1e-12)
  assert.ok(Math.abs(snap.Beta - 29960) < 1e-9)
  assert.ok(Math.abs(snap.WindowMs - 4960) < 1e-9)
})

test('SPEC[latency-008] 指数遗忘：旧观测权重按 γ^n 衰减，充分统计量与逐条参考折叠一致', () => {
  const detector = new RequestLatencyDetector()
  // 参考实现：显式保存全部样本，按 γ^(年龄) 加权求和
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
  assert.ok(Math.abs(snap.ThresholdMs - threshold(5 + k, 25000 + total)) < 1e-6)
  // 有效样本数被 1/(1−γ) = 50 封顶
  assert.ok(snap.Observations < 50)
  // 早期 10 条 100s 已基本遗忘：阈值 ≈ 7.7s（稳态全 1s 时 ≈ 6.3s），远低于不遗忘时 ≈ 26s
  assert.ok(snap.ThresholdMs > 6000 && snap.ThresholdMs < 9000)
  const noForget = threshold(5 + 210, 25000 + 10 * 100000 + 200 * 1000)
  assert.ok(noForget > 2 * snap.ThresholdMs)
})

test('SPEC[latency-018] 内存 O(1)：长序列后 Observations 不超过有效窗口，删失也随遗忘减弱', () => {
  const detector = new RequestLatencyDetector()
  detector.ObserveCensored('s', 600000)
  const afterCensor = detector.ThresholdMs('s')
  for (let i = 0; i < 10000; i += 1) detector.ObserveCompleted('s', 2000)
  const snap = detector.Snapshot('s')
  assert.ok(snap.Observations <= 50 + 1e-9)
  assert.ok(snap.CensoredCount < 1e-50)
  // 稳态：k → 50，S → 50·2000，β/α → (25000+100000)/55
  assert.ok(Math.abs(snap.MeanMs - 125000 / 55) < 1e-6)
  assert.ok(snap.ThresholdMs < afterCensor)
})
