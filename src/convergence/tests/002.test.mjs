import test from 'node:test'
import assert from 'node:assert/strict'

import { KWayMerge } from 'wanxiangli/convergence'
import { event, random } from './support.mjs'

const merger = new KWayMerge()

const ids = (next, count) => {
  const values = new Set()
  while (values.size < count) {
    values.add(Array.from({ length: 40 }, () => Math.floor(next() * 16).toString(16)).join(''))
  }
  return [...values]
}

const scenario = (seed) => {
  const next = random(seed)
  const writerCount = 2 + Math.floor(next() * 7)
  const eventCount = 2 + Math.floor(next() * 17)
  const eventIds = ids(next, eventCount)
  // 第一条因果边固定为逆字典序，保证合并序不能退化成单纯排序。
  const [low, high] = [eventIds[0], eventIds[1]].sort()
  eventIds[0] = high
  eventIds[1] = low
  const events = eventIds.map((id, index) => {
    const parents = new Set(index === 1 ? [eventIds[0]] : [])
    if (index > 0) {
      const extra = Math.floor(next() * 4)
      for (let n = 0; n < extra; n += 1) parents.add(eventIds[Math.floor(next() * index)])
    }
    return event(id, [...parents], { sequence: index })
  })
  const streams = Array.from({ length: writerCount }, (_, index) => [`writer-${index}`, []])
  events.forEach((item) => streams[Math.floor(next() * writerCount)][1].push(item))
  const order = streams.map((_, index) => index)
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1))
    ;[order[index], order[swap]] = [order[swap], order[index]]
  }
  return { events, streams, permuted: order.map((index) => streams[index]) }
}

const ok = (result) => {
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.error))
  return result.events.map((item) => item.id)
}

const assertCausal = (orderedIds, events) => {
  assert.deepEqual(new Set(orderedIds), new Set(events.map((item) => item.id)))
  assert.equal(orderedIds.length, events.length)
  const position = new Map(orderedIds.map((id, index) => [id, index]))
  for (const item of events) {
    for (const parent of item.parents) assert.ok(position.get(parent) < position.get(item.id))
  }
}

test('WHAT[durable-convergence-002] a cross-writer parent precedes its lexically smaller child', () => {
  const parent = event('f'.repeat(40))
  const child = event('0'.repeat(40), [parent.id])
  assert.deepEqual(ok(merger.merge([['writer-child', [child]], ['writer-parent', [parent]]])), [parent.id, child.id])
})

test('WHAT[durable-convergence-002] order is invariant under writer permutation and exact-copy writers', () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const { events, streams, permuted } = scenario(seed)
    const canonical = ok(merger.merge(streams))
    assertCausal(canonical, events)
    assert.deepEqual(ok(merger.merge(permuted)), canonical, `seed ${seed}`)
    const copies = events.map((item) => ({ ...item, parents: [...item.parents], payload: { ...item.payload } }))
    assert.deepEqual(ok(merger.merge([...permuted, ['writer-exact-copy', copies]])), canonical, `seed ${seed}`)
  }
})

test('WHAT[durable-convergence-002] independent streams compose associatively', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const { events } = scenario(seed)
    const roots = events.map((item) => ({ ...item, parents: [] }))
    const streams = [0, 1, 2].map((writer) => [`writer-${writer}`, roots.filter((_, index) => index % 3 === writer)])
    const grouped = (name, inputs) => [name, merger.merge(inputs).events]
    const left = ok(merger.merge([grouped('writer-ab', streams.slice(0, 2)), streams[2]]))
    const right = ok(merger.merge([streams[0], grouped('writer-bc', streams.slice(1))]))
    assert.deepEqual(left, right)
    assert.deepEqual(left, ok(merger.merge(streams)))
  }
})

test('WHAT[durable-convergence-002] ready-heap comparisons grow with log(writers), not writers', () => {
  const writers = 256
  const streams = Array.from({ length: writers }, (_, index) => [
    `writer-${index}`,
    [event(index.toString(16).padStart(40, '0'))],
  ])
  const result = merger.merge(streams)
  assert.equal(result.ok, true)
  // 每次 push/pop 至多 2·log2(256)=16 次比较；线性扫描会接近 writers² = 65536。
  assert.ok(result.readyComparisons <= writers * 2 * 2 * Math.log2(writers), String(result.readyComparisons))
})

test('WHAT[durable-convergence-002] concurrently ready heads are ordered by EventId text, not by writer', () => {
  const low = event('1'.repeat(40))
  const middle = event('5'.repeat(40))
  const high = event('9'.repeat(40))
  assert.deepEqual(
    ok(merger.merge([['writer-a', [high]], ['writer-b', [low]], ['writer-c', [middle]]])),
    [low.id, middle.id, high.id],
  )
})
