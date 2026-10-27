import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RequestLatencyDetector } from '../../../dist/degeneration/Degeneration.js'

// 阈值 = (S/k)·ln(1/(1−Percentile))；无先验。测试内按同一公式计算，不硬编码近似小数。
const threshold = (k, total) => (total / k) * Math.log(1 / (1 - 0.99))
const feed = (detector, sessionId, count, ms) => { for (let i = 0; i < count; i += 1) detector.ObserveCompleted(sessionId, ms) }

test('SPEC[latency-001] 无先验：冷启动阈值为 +∞（不打断）', () => {
  const detector = new RequestLatencyDetector()
  assert.equal(detector.ThresholdMs('cold-session'), Number.POSITIVE_INFINITY)
  assert.equal(detector.Cdf('cold-session', 1e9), 0)
})

test('SPEC[latency-002] 空会话快照是零样本视图，没有任何先验数字', () => {
  const detector = new RequestLatencyDetector()
  const snap = detector.Snapshot('empty-session')
  assert.equal(snap.SessionId, 'empty-session')
  assert.equal(snap.Observations, 0)
  assert.equal(snap.Seen, 0)
  assert.equal(snap.CompletedCount, 0)
  assert.equal(snap.CensoredCount, 0)
  assert.equal(snap.WindowMs, 0)
  assert.equal(snap.Alpha, 0)
  assert.equal(snap.Beta, 0)
  assert.equal(snap.MeanMs, Number.POSITIVE_INFINITY)
  assert.equal(snap.Percentile, 0.99)
  assert.equal(snap.ThresholdMs, Number.POSITIVE_INFINITY)
})

test('SPEC[latency-003] 新手保护期 100 条：前 99 条观测阈值恒为 +∞，第 100 条起按公式给出', () => {
  const detector = new RequestLatencyDetector()
  for (let i = 1; i < 100; i += 1) {
    const snap = detector.ObserveCompleted('s', 1000)
    assert.equal(snap.Seen, i)
    assert.equal(snap.ThresholdMs, Number.POSITIVE_INFINITY, `observation ${i}`)
  }
  const snap = detector.ObserveCompleted('s', 1000)
  assert.equal(snap.Seen, 100)
  assert.ok(Number.isFinite(snap.ThresholdMs))
  assert.ok(Math.abs(snap.ThresholdMs - threshold(snap.CompletedCount, snap.WindowMs)) < 1e-9)
  // 全部 1000ms：S/k = 1000，阈值 = 1000·ln100 ≈ 4605ms
  assert.ok(Math.abs(snap.MeanMs - 1000) < 1e-9)
  assert.ok(Math.abs(snap.ThresholdMs - 1000 * Math.log(100)) < 1e-6)
  assert.ok(Math.abs(detector.ThresholdMs('s') - snap.ThresholdMs) < 1e-12)
})

test('SPEC[latency-004] 删失观测也计入保护期条数，但只有完整样本才给出速率', () => {
  const detector = new RequestLatencyDetector()
  for (let i = 0; i < 150; i += 1) detector.ObserveCensored('s', 5000)
  assert.equal(detector.Snapshot('s').Seen, 150)
  assert.equal(detector.ThresholdMs('s'), Number.POSITIVE_INFINITY)
  detector.ObserveCompleted('s', 5000)
  assert.ok(Number.isFinite(detector.ThresholdMs('s')))
  feed(detector, 't', 100, 5000)
  assert.ok(Math.abs(detector.ThresholdMs('t') - 5000 * Math.log(100)) < 1e-6)
})

test('SPEC[latency-005] 产物不 import 兄弟模块或 node 内建，不触碰定时器与文件系统', () => {
  const artifact = readFileSync(new URL('../../../dist/degeneration/Degeneration.js', import.meta.url), 'utf8')
  assert.doesNotMatch(artifact, /from ["'](wanxiangli\/|node:|gpt-tokenizer)/)
  assert.doesNotMatch(artifact, /\b(setTimeout|setInterval|Date\.now|readFileSync)\b/)
})
