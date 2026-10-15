import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Time } from '../../../dist/time/Time.js'

test('WHAT[TIME-CAPABILITY-004] the emitted module reads no ambient wall clock', async () => {
  const source = await readFile(new URL('../../../dist/time/Time.js', import.meta.url), 'utf8')
  assert.equal(source.includes('Date.now'), false)
  // nodeClockPort 是唯一显式声明的物理例外；虚拟时基与 Deadline 计算不触碰系统时间。
})

test('WHAT[TIME-CAPABILITY-004] the virtual clock ignores real elapsed time', async () => {
  const virtual = Time.virtualClockPort()
  const before = Number(virtual.port.UtcNow())
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(Number(virtual.port.UtcNow()), before)

  const timer = Time.virtualTimerPort()
  let fired = false
  const handle = timer.port.Delay(10)
  handle.Delay.then(() => { fired = true })
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(fired, false)
  timer.advance(10)
  await handle.Delay
  assert.equal(fired, true)
})

test('WHAT[TIME-CAPABILITY-004] the physical clock port is the only declared ambient reader', () => {
  const clock = Time.nodeClockPort()
  const first = Date.parse(clock.UtcNow())
  assert.ok(Number.isFinite(first))
  const later = Date.parse(clock.UtcNow())
  assert.ok(later >= first)
})
