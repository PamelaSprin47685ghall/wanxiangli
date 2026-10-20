import test from 'node:test'
import assert from 'node:assert/strict'
import { Projection } from '../../../dist/projection/Projection.js'

const p = Projection()
const base = (key, rows, fingerprint = 'f') => ({ kind: 'ReplaceMessageBase', key, rows, fingerprint })
const ins = (key, anchor, rows = 1, fingerprint = 'f') => ({ kind: 'InsertMessageRows', key, anchor, rows, fingerprint })
const src = (layout) => layout.rows.map((r) => (r.intent === null ? `b${r.row}` : `${r.intent}:${r.row}`))

test('SPEC[projection-003] no intents leaves the base untouched', () => {
  const out = p.layout([], 3)
  assert.equal(out.ok, true)
  assert.deepEqual(src(out), ['b0', 'b1', 'b2'])
  assert.deepEqual(out.order, [])
})

test('SPEC[projection-003] anchored rows precede their base row; same anchor by key; append after, by key', () => {
  const intents = [ins('z', null), ins('b', 1, 2), ins('a', 1), ins('c', 0), ins('y', 3), ins('m', null)]
  const out = p.layout(intents, 3)
  assert.deepEqual(src(out), ['3:0', 'b0', '2:0', '1:0', '1:1', 'b1', 'b2', '4:0', '5:0', '0:0'])
  assert.deepEqual(out.order, [3, 2, 1, 4, 5, 0])
})

test('SPEC[projection-003] a replacement base is the anchor space and comes first in the order', () => {
  const out = p.layout([ins('k', 1), base('B', 2)], 9)
  assert.deepEqual(src(out), ['1:0', '0:0', '1:1'])
  assert.deepEqual(out.order, [1, 0])
})

test('SPEC[projection-003] equal duplicates are idempotent and the first occurrence represents them', () => {
  const out = p.layout([ins('k', 0), base('B', 1), ins('k', 0), base('B', 1)], 0)
  assert.deepEqual(src(out), ['0:0', '1:0'])
  assert.deepEqual(out.order, [1, 0])
})

test('SPEC[projection-003] conflicts are explicit: any base difference, and the least conflicting key', () => {
  assert.deepEqual({ ...p.layout([base('A', 1), base('B', 1)], 0) }, { ok: false, conflict: 'ConflictingMessageBase' })
  assert.deepEqual({ ...p.layout([base('A', 1), base('A', 1, 'g')], 0) }, { ok: false, conflict: 'ConflictingMessageBase' })
  assert.deepEqual({ ...p.layout([base('A', 1), base('A', 2)], 0) }, { ok: false, conflict: 'ConflictingMessageBase' })
  for (const other of [ins('k', 1), ins('k', null), ins('k', 0, 2), ins('k', 0, 1, 'g')]) {
    assert.deepEqual({ ...p.layout([ins('k', 0), other], 5) }, { ok: false, conflict: 'ConflictingMessageRows', key: 'k' })
  }
  const two = [ins('z', 0), ins('z', 1), ins('b', 0), ins('b', 1, 1, 'g')]
  assert.deepEqual({ ...p.layout(two, 5) }, { ok: false, conflict: 'ConflictingMessageRows', key: 'b' })
  // a base conflict wins over a row conflict
  assert.deepEqual({ ...p.layout([ins('k', 0), ins('k', 1), base('A', 1), base('B', 1)], 5) }, { ok: false, conflict: 'ConflictingMessageBase' })
})

test('SPEC[projection-003] the answer does not depend on registration order', () => {
  const intents = [ins('a', 2), ins('b', 0, 2), ins('c', null), ins('d', 2), ins('e', null, 3), base('B', 4), ins('a', 2)]
  const resolve = (list) => {
    const out = p.layout(list, 1)
    return out.rows.map((r) => (r.intent === null ? `b${r.row}` : `${list[r.intent].key}:${r.row}`))
  }
  const expected = resolve(intents)
  let seed = 7
  for (let round = 0; round < 200; round++) {
    const shuffled = [...intents]
    for (let i = shuffled.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      const j = seed % (i + 1)
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    assert.deepEqual(resolve(shuffled), expected)
  }
})

test('SPEC[projection-003] malformed input and anchors past the base are refused; answers are frozen', () => {
  assert.throws(() => p.layout([ins('k', 4)], 3), /anchor 4 is past the end of the message base \(3\)/)
  assert.deepEqual(src(p.layout([ins('k', 3)], 3)), ['b0', 'b1', 'b2', '0:0'])
  assert.throws(() => p.layout([], -1), /baseLength must be a nonnegative safe integer/)
  assert.throws(() => p.layout([], 1.5), /baseLength/)
  assert.throws(() => p.layout({}, 0), /intents must be an array/)
  assert.throws(() => p.layout([, ins('k', 0)], 0), /must not be sparse/)
  assert.throws(() => p.layout([{ ...ins('k', 0), kind: 'Prefix' }], 0), /kind must be ReplaceMessageBase or InsertMessageRows/)
  assert.throws(() => p.layout([{ ...base('k', 0), anchor: 0 }], 0), /anchor is not accepted on ReplaceMessageBase/)
  assert.throws(() => p.layout([ins('k', -1)], 0), /anchor must be null \(append\) or a nonnegative safe integer/)
  assert.throws(() => p.layout([ins('k', 0, 1.2)], 0), /rows must be a nonnegative safe integer/)
  assert.throws(() => p.layout([ins(3, 0)], 0), /key must be a string/)
  assert.throws(() => p.layout([ins('k', 0, 1, null)], 0), /fingerprint must be a string/)
  let reads = 0
  const sneaky = ins('k', 0)
  Object.defineProperty(sneaky, 'rows', { enumerable: true, get: () => { reads++; return 1 } })
  assert.throws(() => p.layout([sneaky], 0), /Accessor field is not accepted: intents\[0\].rows/)
  assert.equal(reads, 0)
  const list = [ins('k', 0)]
  const out = p.layout(list, 1)
  assert.ok(Object.isFrozen(out) && Object.isFrozen(out.rows) && Object.isFrozen(out.rows[0]) && Object.isFrozen(out.order))
  list[0].anchor = null
  assert.deepEqual(src(out), ['0:0', 'b0'])
})

test('SPEC[projection-003] plan answers the same order and conflicts as layout without checking anchor range', () => {
  const lists = [
    [ins('z', null), ins('b', 1, 2), ins('a', 1), ins('c', 0), ins('y', 3), ins('m', null)],
    [ins('k', 1), base('B', 2)],
    [base('A', 1), base('B', 1)],
    [ins('z', 0), ins('z', 1), ins('b', 0), ins('b', 1, 1, 'g')],
  ]
  for (const list of lists) {
    const laid = p.layout(list, 9)
    const plan = p.plan(list)
    assert.ok(Object.isFrozen(plan))
    assert.deepEqual({ ...plan }, laid.ok ? { ok: true, order: laid.order } : { ...laid })
  }
  assert.deepEqual([...p.plan([ins('k', 40)]).order], [0])
  assert.throws(() => p.plan({}), /intents must be an array/)
})
