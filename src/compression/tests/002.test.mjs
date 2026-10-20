import test from 'node:test'
import assert from 'node:assert/strict'
import { Compression, view } from './support.mjs'

const law = Compression()
const fold = (positions, history, prefixUntil = 0) =>
  law.project(positions, history, prefixUntil).entries.map((e) =>
    e.kind === 'kept' ? `${e.position}` : e.kind === 'opening' ? `0=${e.summary}` : `${e.position}=${e.summary}@${e.index}`)

test('SPEC[compression-002] anchor 0 always lives and replaced anchors never come back', () => {
  assert.deepEqual(law.live([], []), [0])
  assert.deepEqual(law.live([3, 1, 2, 2], []), [0, 1, 2, 3])
  const history = [{ anchor: 2, until: 3, summary: 's' }, { anchor: 0, until: 1, summary: 'o' }]
  assert.deepEqual(law.live([1, 2, 3], history), [0, 1, 3])
})

test('SPEC[compression-002] plan ignores protected and dead anchors and captures the live interval', () => {
  const changes = law.plan([1, 2, 3, 4], [{ anchor: 3, until: 4, summary: 'x' }],
    view(2, [[1, 'one'], [2, 'two'], [3, 'three'], [4, null], [9, 'ghost']]))
  assert.deepEqual(changes, [{ anchor: 2, until: 4, summary: 'two' }])
  // 等于边界可替换；最后一个区间到输入末尾。
  assert.deepEqual(law.plan([1, 5], [], view(5, [[5, 'tail']])), [{ anchor: 5, until: 6, summary: 'tail' }])
  assert.deepEqual(law.plan([1], [], view(0, [[0, 'all']])), [{ anchor: 0, until: 1, summary: 'all' }])
})

test('SPEC[compression-002] replacing 6 then 5 makes the second summary cover the first', () => {
  const positions = [0, 5, 5, 6, 6, 7]
  let history = [...law.plan([5, 6, 7], [], view(0, [[6, 'six']]))]
  assert.deepEqual(fold(positions, history), ['0', '5', '5', '6=six@3', '7'])
  history = [...history, ...law.plan([5, 6, 7], history, view(0, [[5, 'five']]))]
  assert.deepEqual(history.at(-1), { anchor: 5, until: 7, summary: 'five' })
  assert.deepEqual(fold(positions, history), ['0', '5=five@1', '7'])
})

test('SPEC[compression-002] an old tail replacement does not swallow later content', () => {
  const history = law.plan([1, 2], [], view(0, [[2, 'tail']]))
  assert.deepEqual(fold([1, 2, 2, 3, 4], history), ['1', '2=tail@1', '3', '4'])
})

test('SPEC[compression-002] same-round adjacent summaries do not swallow each other', () => {
  const history = law.plan([1, 2, 3], [], view(0, [[2, 'b'], [1, 'a']]))
  assert.deepEqual(history.map((r) => [r.anchor, r.until]), [[1, 2], [2, 3]])
  assert.deepEqual(fold([1, 2, 3], history), ['1=a@0', '2=b@1', '3'])
})

test('SPEC[compression-002] opening summary replaces everything before the next live anchor', () => {
  const history = law.plan([1, 3], [{ anchor: 1, until: 3, summary: 'one' }], view(0, [[0, 'zero']]))
  assert.deepEqual(history, [{ anchor: 0, until: 3, summary: 'zero' }])
  const all = [{ anchor: 1, until: 3, summary: 'one' }, ...history]
  const projected = law.project([0, 1, 2, 3], all, 1)
  assert.deepEqual(projected.entries.map((e) => [e.kind, e.position, e.cached]), [['opening', 0, true], ['kept', 3, false]])
  assert.deepEqual([projected.kept, projected.summarized, projected.folded, projected.replaced], [1, 1, 3, [0, 1]])
})

test('SPEC[compression-002] a replacement that covers nothing leaves rows unchanged', () => {
  assert.deepEqual(fold([0, 1], [{ anchor: 4, until: 6, summary: 'x' }]), ['0', '1'])
})
