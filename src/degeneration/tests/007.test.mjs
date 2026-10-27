import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RequestLatencyDetector,
  createRequestLatencyDetector,
  requestLatencyDetector,
} from '../../../dist/degeneration/Degeneration.js'

test('SPEC[latency-012] session 之间互相隔离', () => {
  const detector = new RequestLatencyDetector()
  detector.ObserveCompleted('a', 1000)
  detector.ObserveCompleted('b', 5000)
  assert.equal(detector.Snapshot('a').Beta, 26000)
  assert.equal(detector.Snapshot('b').Beta, 30000)
  assert.equal(detector.Snapshot('a').Observations, 1)
  assert.equal(detector.Snapshot('b').Observations, 1)
})

test('SPEC[latency-013] Forget 只清目标会话，Clear 清空全部', () => {
  const detector = new RequestLatencyDetector()
  detector.ObserveCompleted('a', 1000)
  detector.ObserveCompleted('b', 5000)
  detector.Forget('a')
  const snapA = detector.Snapshot('a')
  assert.equal(snapA.Observations, 0)
  assert.equal(snapA.Alpha, 5)
  assert.equal(snapA.Beta, 25000)
  assert.equal(detector.Snapshot('b').Observations, 1)
  detector.Clear()
  assert.equal(detector.Snapshot('b').Observations, 0)
  assert.equal(detector.Snapshot('b').Alpha, 5)
})

test('SPEC[latency-014] 单例与工厂实例互不影响', () => {
  const factoryMade = createRequestLatencyDetector()
  const directMade = new RequestLatencyDetector()
  factoryMade.ObserveCompleted('x', 1000)
  requestLatencyDetector.ObserveCompleted('shared', 2000)
  assert.equal(directMade.Snapshot('x').Observations, 0)
  assert.equal(directMade.Snapshot('shared').Observations, 0)
  assert.equal(factoryMade.Snapshot('shared').Observations, 0)
  assert.equal(requestLatencyDetector.Snapshot('shared').Observations, 1)
  assert.equal(requestLatencyDetector.Snapshot('x').Observations, 0)
  requestLatencyDetector.Clear()
})

test('SPEC[latency-015] 非法输入抛错且不污染状态', () => {
  const detector = new RequestLatencyDetector()
  assert.throws(() => detector.ThresholdMs(''))
  assert.throws(() => detector.ThresholdMs('   '))
  assert.throws(() => detector.ThresholdMs(null))
  assert.throws(() => detector.ObserveCompleted('', 1000))
  assert.throws(() => detector.ObserveCompleted('s', 0))
  assert.throws(() => detector.ObserveCompleted('s', -1))
  assert.throws(() => detector.ObserveCompleted('s', Number.POSITIVE_INFINITY))
  assert.throws(() => detector.ObserveCompleted('s', Number.NaN))
  assert.throws(() => detector.ObserveCensored('s', 0))
  assert.throws(() => detector.ObserveCensored('s', Number.NEGATIVE_INFINITY))
  assert.throws(() => detector.Cdf('s', -1))
  assert.throws(() => detector.Cdf('s', Number.NaN))
  assert.throws(() => detector.Cdf('s', Number.POSITIVE_INFINITY))
  assert.throws(() => detector.Snapshot(''))
  assert.throws(() => detector.Forget(''))
  // 全部被拒绝之后，会话仍是先验零样本
  assert.equal(detector.Snapshot('s').Observations, 0)
  assert.equal(detector.Snapshot('s').Beta, 25000)
  // elapsedMs = 0 是合法边界
  assert.equal(detector.Cdf('s', 0), 0)
})

test('SPEC[latency-016] 快照是新对象：外部修改不回流', () => {
  const detector = new RequestLatencyDetector()
  const snap = detector.ObserveCompleted('s', 1000)
  snap.Alpha = 999
  snap.Observations = 999
  const again = detector.Snapshot('s')
  assert.equal(again.Alpha, 6)
  assert.equal(again.Observations, 1)
  assert.notStrictEqual(snap, again)
  again.Beta = 0
  assert.equal(detector.Snapshot('s').Beta, 26000)
})

test('SPEC[latency-017] 只读调用不改统计状态', () => {
  const detector = new RequestLatencyDetector()
  detector.ObserveCompleted('s', 1000)
  const before = detector.Snapshot('s')
  detector.ThresholdMs('s')
  detector.Cdf('s', 500)
  detector.Snapshot('s')
  const after = detector.Snapshot('s')
  assert.deepEqual(after, before)
})
