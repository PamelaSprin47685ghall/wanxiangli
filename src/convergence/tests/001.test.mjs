import test from 'node:test'
import assert from 'node:assert/strict'

import { KWayMerge } from 'wanxiangli/convergence'
import { event, hex } from './support.mjs'

const merger = new KWayMerge()

test('WHAT[durable-convergence-001] union keeps both branches of a legal two-writer fork', () => {
  const root = event(hex('a'))
  const left = event(hex('b'), [root.id], { side: 'left' })
  const right = event(hex('c'), [root.id], { side: 'right' })
  const result = merger.merge([
    ['writer-left', [root, left]],
    ['writer-right', [root, right]],
  ])
  assert.equal(result.ok, true, JSON.stringify(result.error))
  assert.deepEqual(result.events.map((item) => item.id), [root.id, left.id, right.id])
})

test('WHAT[durable-convergence-001] identical duplicates collapse and results are the caller objects', () => {
  const root = event(hex('a'))
  const copy = { ...root, parents: [...root.parents], payload: { ...root.payload }, payloadRefs: [] }
  const result = merger.merge([
    ['writer-1', [root]],
    ['writer-2', [copy]],
  ])
  assert.equal(result.ok, true)
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0], root)
})

test('WHAT[durable-convergence-001] same id with different bytes is an identity collision, not a dedupe', () => {
  const original = event(hex('a'), [], { value: 1 })
  const forged = event(hex('a'), [], { value: 2 })
  const result = merger.merge([
    ['writer-1', [original]],
    ['writer-2', [forged]],
  ])
  assert.equal(result.ok, false)
  assert.deepEqual(result.error, { code: 'IdentityCollision', eventId: original.id })
})

test('WHAT[durable-convergence-001] malformed stream input is rejected instead of skipped', () => {
  assert.equal(merger.merge([['writer-1', [{ id: 7, parents: [] }]]]).error.code, 'MalformedEnvelope')
  assert.equal(merger.merge([['writer-1']]).error.code, 'MalformedEnvelope')
  assert.equal(merger.merge('nope').error.code, 'MalformedEnvelope')
})
