import test from 'node:test'
import assert from 'node:assert/strict'

import { CanonicalEventCodec } from 'wanxiangli/events'

const codec = new CanonicalEventCodec()

const event = (id, parents = []) => ({
  id,
  stream: 'job/main',
  type: 'JobRequested',
  parents,
  payload: {},
  payloadRefs: [],
})

const root = 'a'.repeat(40)
const left = 'b'.repeat(40)
const right = 'c'.repeat(40)

// D-04: this test pins the single-writer codec's structural view of a legal
// fork (two heads, no adjudication semantics). Multi-writer convergence — how
// two writers each produce such a history and how a ruling event merges them —
// is CUT-19 and deliberately not modeled here.
test('WHAT[durable-events-008] a legal fork validates with two heads, not a conflict', () => {
  const result = codec.validate(
    [event(root), event(left, [root]), event(right, [root])],
    () => true,
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.heads, [left, right])
})

test('WHAT[durable-events-008] a ruling event over all heads restores a single head', () => {
  const ruling = 'd'.repeat(40)
  const result = codec.validate(
    [event(root), event(left, [root]), event(right, [root]), event(ruling, [left, right])],
    () => true,
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.heads, [ruling])
})

test('WHAT[durable-events-008] a partial ruling leaves the uncovered head open', () => {
  const partial = 'd'.repeat(40)
  const result = codec.validate(
    [event(root), event(left, [root]), event(right, [root]), event(partial, [left])],
    () => true,
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.heads, [partial, right].sort())
})

test('WHAT[durable-events-008] validate output is deduplicated and sorted by id', () => {
  const result = codec.validate(
    [event(right, [root]), event(root), event(left, [root]), event(root)],
    () => true,
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.events.map(item => item.id), [root, left, right].sort())
})
