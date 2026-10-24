import test from 'node:test'
import assert from 'node:assert/strict'
import { Time } from '../../../../dist/runtime/Runtime.js'

// 库仓单 bundle 形态下的分居边界（相对主仓 fsproj 级分居的明示缩减）：
// 生产构造器与验证构造器在同一导出对象上分组，虚拟入口仅供测试注入。

test('WHAT[TIME-CAPABILITY-008] the export surface separates production and verification constructors', () => {
  const production = ['nodeTimerPort', 'nodeClockPort', 'timerTask', 'raceExit']
  const verification = ['virtualTimerPort', 'virtualClockPort']
  for (const name of production) assert.equal(typeof Time[name], 'function', name)
  for (const name of verification) assert.equal(typeof Time[name], 'function', name)
})

test('WHAT[TIME-CAPABILITY-008] deadline algebra is independent of both adapters', () => {
  // Deadline 计算不依赖物理或虚拟实现：任何时钟值都由调用方以 ISO 字符串显式给出。
  const deadline = Time.deadlineCreate('2026-10-15T00:00:00.000Z', 100)
  assert.equal(Time.deadlineRemainingMs('2026-10-15T00:00:00.000Z', deadline), 100)
})

test('WHAT[TIME-CAPABILITY-008] a physical port instance never observes the virtual clock', () => {
  const virtual = Time.virtualClockPort()
  virtual.advanceMs(100000)
  const physical = Time.nodeClockPort()
  const parsed = Date.parse(physical.UtcNow())
  // 物理时钟读到的是真实系统时间（2026 年），不是虚拟游标的 2000 年原点。
  assert.ok(parsed > Date.parse('2026-01-01T00:00:00.000Z'))
})

test('WHAT[TIME-CAPABILITY-008] Runtime has no sibling dependency and time algebra owns no filesystem or process', async () => {
  const { readFileSync } = await import('node:fs')
  const runtime = readFileSync(new URL('../../../../dist/runtime/Runtime.js', import.meta.url), 'utf8')
  assert.doesNotMatch(runtime, /from ["']wanxiangli\//)
  for (const file of ['Deadline.fs', 'VirtualTiming.fs']) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /node:fs|node:child_process|wanxiangli\//)
  }
})
