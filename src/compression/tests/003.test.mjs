import test from 'node:test'
import assert from 'node:assert/strict'
import { Compression, view } from './support.mjs'

const law = Compression()

test('SPEC[compression-003] malformed coverage input is rejected before any judgement', () => {
  assert.throws(() => law.live(null, []), /anchors must be an array/)
  assert.throws(() => law.live([1.5], []), /anchor must be a non-negative integer anchor number/)
  assert.throws(() => law.live([1], [{ anchor: 1, until: 2 }]), /replacement.summary is required/)
  assert.throws(() => law.plan([1], [], { prefixUntil: 0 }), /view.thenMap is required/)
  assert.throws(() => law.plan([1], [], view(0, [[1]])), /\[anchor, summary\] pair/)
  assert.throws(() => law.project([0, -1], [], 0), /position must be/)
  // eslint-disable-next-line no-sparse-arrays
  assert.throws(() => law.live([1, , 2], []), /must not be sparse/)
})

test('SPEC[compression-003] accessor fields are refused without being read', () => {
  let reads = 0
  const sneaky = { anchor: 1, until: 2 }
  Object.defineProperty(sneaky, 'summary', { enumerable: true, get: () => { reads++; return 's' } })
  assert.throws(() => law.live([1], [sneaky]), /Accessor field is not accepted: summary/)
  assert.equal(reads, 0)
})

test('SPEC[compression-003] answers are frozen and independent of later caller mutation', () => {
  const history = [{ anchor: 2, until: 3, summary: 's' }]
  const positions = [0, 1, 2]
  const projected = law.project(positions, history, 0)
  const planned = law.plan([1, 2], [], view(0, [[1, 'a']]))
  assert.ok(Object.isFrozen(projected) && Object.isFrozen(projected.entries) && Object.isFrozen(projected.entries[0]))
  assert.ok(Object.isFrozen(planned) && Object.isFrozen(planned[0]))
  history[0].anchor = 0
  positions[2] = 9
  assert.deepEqual(projected.entries.map((e) => e.kind), ['kept', 'kept', 'summarized'])
  assert.deepEqual(projected.replaced, [2])
})
