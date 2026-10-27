import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RequestLatencyDetector } from '../../../dist/degeneration/Degeneration.js'

// 阈值 = (β/α)·ln(1/(1−Percentile))；测试内按同一公式计算，不硬编码近似小数。
const threshold = (alpha, beta) => (beta / alpha) * Math.log(1 / (1 - 0.99))

test('SPEC[latency-001] 冷启动阈值等于先验均值尺度下的 99% 分位', () => {
  const detector = new RequestLatencyDetector()
  const cold = detector.ThresholdMs('cold-session')
  assert.ok(Math.abs(cold - threshold(5, 25000)) < 1e-9)
  // 数量级参考：5000·ln100 ≈ 23025.85ms
  assert.ok(cold > 20000 && cold < 26000)
})

test('SPEC[latency-002] 空会话快照是先验零样本视图', () => {
  const detector = new RequestLatencyDetector()
  const snap = detector.Snapshot('empty-session')
  assert.equal(snap.SessionId, 'empty-session')
  assert.equal(snap.Observations, 0)
  assert.equal(snap.CompletedCount, 0)
  assert.equal(snap.CensoredCount, 0)
  assert.equal(snap.WindowMs, 0)
  assert.equal(snap.Alpha, 5)
  assert.equal(snap.Beta, 25000)
  assert.equal(snap.MeanMs, 5000)
  assert.equal(snap.Percentile, 0.99)
  assert.ok(Math.abs(snap.ThresholdMs - threshold(5, 25000)) < 1e-9)
})

test('SPEC[latency-003] 完整样本更新后 Alpha/Beta/阈值符合公式', () => {
  const detector = new RequestLatencyDetector()
  const snap = detector.ObserveCompleted('s1', 1000)
  assert.equal(snap.SessionId, 's1')
  assert.equal(snap.Observations, 1)
  assert.equal(snap.CompletedCount, 1)
  assert.equal(snap.CensoredCount, 0)
  assert.equal(snap.WindowMs, 1000)
  assert.equal(snap.Alpha, 6)
  assert.equal(snap.Beta, 26000)
  assert.equal(snap.MeanMs, 26000 / 6)
  assert.ok(Math.abs(snap.ThresholdMs - threshold(6, 26000)) < 1e-9)
  assert.ok(snap.ThresholdMs > 15000 && snap.ThresholdMs < 25000)
  assert.ok(Math.abs(detector.ThresholdMs('s1') - snap.ThresholdMs) < 1e-12)
})

test('SPEC[latency-004] 50 条 5000ms 样本让阈值回到冷启动同值', () => {
  const detector = new RequestLatencyDetector()
  const cold = detector.ThresholdMs('s')
  for (let i = 0; i < 50; i += 1) detector.ObserveCompleted('s', 5000)
  const snap = detector.Snapshot('s')
  assert.equal(snap.Observations, 50)
  assert.equal(snap.Alpha, 55)
  assert.equal(snap.Beta, 275000)
  assert.equal(snap.MeanMs, 5000)
  // β/α 回到 5000，阈值与冷启动完全一致：证明窗口与先验口径正确
  assert.ok(Math.abs(snap.ThresholdMs - cold) < 1e-12)
  assert.ok(Math.abs(snap.ThresholdMs - threshold(55, 275000)) < 1e-9)
})

test('SPEC[latency-005] 产物不 import 兄弟模块或 node 内建，不触碰定时器与文件系统', () => {
  const artifact = readFileSync(new URL('../../../dist/degeneration/Degeneration.js', import.meta.url), 'utf8')
  assert.doesNotMatch(artifact, /from ["'](wanxiangli\/|node:|gpt-tokenizer)/)
  assert.doesNotMatch(artifact, /\b(setTimeout|setInterval|Date\.now|readFileSync)\b/)
})
