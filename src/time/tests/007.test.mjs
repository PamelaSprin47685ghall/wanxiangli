import test from 'node:test'
import assert from 'node:assert/strict'
import { Time } from '../../../dist/time/Time.js'

// TIME-CAPABILITY-007 的完整语义（SessionStartedAt 首次 prompt 单次采样与持久化）
// 属于主仓会话层；本库只提供它依赖的稳定时基：固定原点、显式推进、一次采样后不漂移。

test('WHAT[TIME-CAPABILITY-007] a virtual clock keeps a stable origin until explicitly moved', () => {
  const virtual = Time.virtualClockPort()
  virtual.set('2026-10-15T08:00:00.000Z')
  const origin = Number(virtual.port.UtcNow())
  // 重试或重启语义由调用方持久化原点；时钟本身不重置、不重算。
  assert.equal(Number(virtual.port.UtcNow()), origin)
  virtual.advanceMs(1000)
  assert.equal(Number(virtual.port.UtcNow()) - origin, 1000)
  // 新 occurrence 从同一时钟采样；原点不因读取而漂移。
  assert.equal(Number(virtual.port.UtcNow()) - origin, 1000)
})

test('WHAT[TIME-CAPABILITY-007] elapsed is derived from the injected clock, not from real time', async () => {
  const virtual = Time.virtualClockPort()
  const start = Number(virtual.port.UtcNow())
  await new Promise(resolve => setTimeout(resolve, 20))
  // 真实时间流逝不进入虚拟时钟的 elapsed。
  assert.equal(Number(virtual.port.UtcNow()) - start, 0)
  virtual.advanceMs(42)
  assert.equal(Number(virtual.port.UtcNow()) - start, 42)
})
