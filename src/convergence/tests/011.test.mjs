import test from 'node:test'
import assert from 'node:assert/strict'

import { KWayMerge } from 'wanxiangli/convergence'
import { event, hex } from './support.mjs'

const merger = new KWayMerge()
const expired = hex('9')

test('WHAT[durable-convergence-011] strict merge reports a parent outside the supplied set', () => {
  const child = event(hex('b'), [expired])
  assert.deepEqual(merger.merge([['writer-1', [child]]]).error, { code: 'MissingParent', eventId: expired })
})

test('WHAT[durable-convergence-011] retained merge treats a parent absent from the whole set as the window boundary', () => {
  const child = event(hex('b'), [expired])
  const grandchild = event(hex('a'), [child.id])
  const result = merger.mergeRetained([['writer-1', [child]], ['writer-2', [grandchild]]])
  assert.equal(result.ok, true, JSON.stringify(result.error))
  assert.deepEqual(result.events.map((item) => item.id), [child.id, grandchild.id])
})

test('WHAT[durable-convergence-011] retained merge still orders and checks dependencies present inside the set', () => {
  const left = event(hex('a'), [hex('b')])
  const right = event(hex('b'), [hex('a')])
  const cyclic = merger.mergeRetained([['writer-1', [left]], ['writer-2', [right]]])
  assert.equal(cyclic.ok, false)
  assert.equal(cyclic.error.code, 'NonCanonical')

  const strict = merger.merge([['writer-1', [left]], ['writer-2', [right]]])
  assert.equal(strict.ok, false)
  assert.equal(strict.error.code, 'NonCanonical')
})

test('WHAT[durable-convergence-011] backward order inside one writer is a frontier error, not a reorder', () => {
  const parent = event(hex('a'))
  const child = event(hex('b'), [parent.id])
  const result = merger.merge([['writer-1', [child, parent]]])
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'NonCanonical')
})
