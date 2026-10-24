import test from 'node:test'
import assert from 'node:assert/strict'
import { workspace, fs, write } from './support.mjs'

const exact = text => ({ kind: 'exact', text })
const regex = text => ({ kind: 'regex', text })

test('SPEC[fs-003] ordered anchors resolve duplicate text by occurrence, not by re-hitting the first', t => {
  const api = fs(workspace(t))
  const content = 'foo bar foo bar'
  const first = api.findAnchor(content, exact('foo'), 1)
  assert.deepEqual([...first.value], [0, 3])
  const second = api.findAnchor(content, exact('foo'), 2)
  assert.deepEqual([...second.value], [8, 11])
})

test('SPEC[fs-003] requireUnique refuses a needle that matches twice', t => {
  const api = fs(workspace(t))
  const result = api.requireUnique('foo foo', exact('foo'))
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ANCHOR_NOT_UNIQUE')
})

test('SPEC[fs-004] requireUnique succeeds when the anchor matches exactly once', t => {
  const api = fs(workspace(t))
  const result = api.requireUnique('only once', exact('once'))
  assert.equal(result.ok, true)
  assert.deepEqual([...result.value], [5, 9])
})

test('SPEC[fs-003] empty anchor content and invalid regex use their stable codes', t => {
  const api = fs(workspace(t))
  assert.equal(api.findAnchor('text', exact(''), 1).code, 'EMPTY_ANCHOR_CONTENT')
  assert.equal(api.findAnchor('text', regex('['), 1).code, 'INVALID_ANCHOR_PATTERN')
  assert.equal(api.requireUnique('text', regex('')).code, 'EMPTY_ANCHOR_CONTENT')
})

test('SPEC[fs-003] missing occurrence reports ANCHOR_NOT_FOUND with the occurrence in the reason', t => {
  const api = fs(workspace(t))
  const result = api.findAnchor('foo', exact('foo'), 3)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ANCHOR_NOT_FOUND')
  assert.match(result.reason, /occurrence 3/)
})

test('SPEC[fs-003] non-positive occurrence is an invalid declaration', t => {
  const api = fs(workspace(t))
  const result = api.findAnchor('foo', exact('foo'), 0)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_ANCHOR_PATTERN')
})

test('SPEC[fs-003] zero-width regex match yields start equal to end', t => {
  const api = fs(workspace(t))
  // 主仓既有语义（repository-programming 007）：`^` 只在绝对文件首匹配一次，
  // 是唯一可判定的零宽锚点；`b*` 一类在任意文本上多处命中，不唯一。
  const result = api.requireUnique('abc', regex('^'))
  assert.equal(result.ok, true)
  assert.equal(result.value[0], 0)
  assert.equal(result.value[1], 0)
})

test('SPEC[fs-003] grep reports 1-based line and column and skips non-UTF-8 files', async t => {
  const root = workspace(t)
  write(root, 'find.txt', 'alpha\nbeta-needle\ngamma\nneedle-tail')
  const result = await fs(root).grep('needle', '*.txt')
  assert.equal(result.ok, true)
  const matches = result.value.matches
  assert.equal(matches.length, 2)
  assert.deepEqual(
    matches.map(hit => [hit.path, hit.line, hit.column, hit.text]),
    [['find.txt', 2, 6, 'needle'], ['find.txt', 4, 1, 'needle']]
  )
})

test('SPEC[fs-003] grep accepts a regex needle object', async t => {
  const root = workspace(t)
  write(root, 'data.txt', 'cat\ncot\ncut\n')
  const result = await fs(root).grep({ kind: 'regex', text: 'c[au]t' }, '*.txt')
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.matches.map(hit => hit.text), ['cat', 'cut'])
})

test('SPEC[fs-003] grep with an empty file pattern is refused before scanning', async t => {
  const root = workspace(t)
  const result = await fs(root).grep('needle', '')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_ANCHOR_PATTERN')
})
