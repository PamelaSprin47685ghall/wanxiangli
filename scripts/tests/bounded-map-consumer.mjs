import assert from 'node:assert/strict'
import { mapBounded } from 'wanxiangli/bounded-map'

const controller = new AbortController()
const gates = [Promise.withResolvers(), Promise.withResolvers()]
const started = Promise.withResolvers()
let active = 0
let peak = 0
const result = mapBounded(2, async (item, signal) => {
  assert.equal(signal, controller.signal)
  active++
  peak = Math.max(peak, active)
  if (active === 2) started.resolve()
  try {
    await gates[item].promise
    return item + 10
  } finally {
    active--
  }
}, [0, 1], controller.signal)
await started.promise
gates[1].resolve()
gates[0].resolve()
assert.deepEqual(await result, [10, 11])
assert.equal(peak, 2)
assert.equal(active, 0)
assert.deepEqual(await mapBounded(1, async (item, signal) => {
  assert.ok(signal instanceof AbortSignal)
  assert.equal(signal.aborted, false)
  return item * 2
}, [2, 3]), [4, 6])
const reason = new Error('consumer abort')
controller.abort(reason)
await assert.rejects(mapBounded(1, async () => { throw new Error('must not start') }, [1], controller.signal), actual => {
  assert.equal(actual, reason)
  return true
})
const error = new Error('consumer failure')
await assert.rejects(mapBounded(1, () => { throw error }, [1]), actual => {
  assert.equal(actual, error)
  return true
})
console.log('bounded-map consumer passed')
