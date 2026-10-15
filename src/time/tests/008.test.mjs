import test from 'node:test'
import assert from 'node:assert/strict'
import { Time } from '../../../dist/time/Time.js'

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

test('WHAT[TIME-CAPABILITY-008] the module imports no sibling library', async () => {
  const source = await import('node:fs').then(fs => fs.readFileSync(new URL('../../../dist/time/Time.js', import.meta.url), 'utf8'))
  assert.equal(source.includes('wanxiangli/'), false)
  assert.equal(source.includes('node:fs'), false)
  assert.equal(source.includes('node:child_process'), false)
})
