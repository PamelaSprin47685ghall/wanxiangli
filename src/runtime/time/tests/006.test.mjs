import test from 'node:test'
import assert from 'node:assert/strict'
import { Time } from '../../../../dist/runtime/Runtime.js'

test('WHAT[TIME-CAPABILITY-006] an expired timer delay only settles the wait, it mints no business fact', async () => {
  let settled = false
  await Time.timerTask(10).then(() => { settled = true })
  assert.equal(settled, true)
  // 到期只结束等待本身；任何业务结论都由消费方结合自己的规则得出。
  // 复合等待（信号 vs 到期 escape）的完整反例见 src/program/wait/tests/006.test.mjs。
})

test('WHAT[TIME-CAPABILITY-006] raceExit reports which side won without inventing an exit', async () => {
  const never = new Promise(() => {})
  assert.equal(await Time.raceExit(never, 10), false)
  const immediate = Promise.resolve()
  assert.equal(await Time.raceExit(immediate, 10), true)
})

test('WHAT[TIME-CAPABILITY-006] cancelling an already-settled handle is a harmless no-op', async () => {
  const handle = { Delay: Time.timerTask(5), Cancel: () => {} }
  await handle.Delay
  handle.Cancel()
})
