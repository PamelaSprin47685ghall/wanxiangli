import test from 'node:test'
import assert from 'node:assert/strict'

import { KWayMerge } from 'wanxiangli/convergence'
import { event, hex } from './support.mjs'

const merger = new KWayMerge()

// 反例：旧主仓 EventKWayMerge 以 Map.ofList 折叠同名 writer 流，后一条整条覆盖前一条，
// 合法分叉的一支就此消失且结果为 Ok。这里要求失败可见。
test('WHAT[durable-convergence-003] a writer id that names two streams is rejected, not silently collapsed', () => {
  const root = event(hex('a'))
  const left = event(hex('b'), [root.id])
  const right = event(hex('c'), [root.id])
  const result = merger.merge([
    ['writer-1', [root, left]],
    ['writer-1', [root, right]],
  ])
  assert.equal(result.ok, false)
  assert.deepEqual(result.error, { code: 'NonCanonical', reason: 'duplicate writer stream: writer-1' })
})

test('WHAT[durable-convergence-003] one aggregated logical stream per writer keeps its append order', () => {
  const first = event(hex('e'))
  const second = event(hex('1'), [first.id])
  const third = event(hex('0'))
  const result = merger.merge([['writer-1', [first, second, third]]])
  assert.equal(result.ok, true)
  assert.deepEqual(result.events.map((item) => item.id), [first.id, second.id, third.id])
})
