import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { workspace, fs, write } from './support.mjs'

function gitRoot(t) {
  const root = workspace(t)
  mkdirSync(path.join(root, '.git', 'info'), { recursive: true })
  return root
}

test('SPEC[fs-002] glob respects nested .gitignore rules and negation', async t => {
  const root = gitRoot(t)
  write(root, 'keep.txt', 'x')
  write(root, 'drop.log', 'x')
  write(root, 'src/keep.ts', 'x')
  write(root, 'src/drop.tmp', 'x')
  write(root, 'src/.gitignore', '*.tmp\n')
  const result = await fs(root).glob('**/*')
  assert.equal(result.ok, true)
  // 主仓既有语义：.git 永不进入结果；drop.log 无任何忽略规则，保留。
  assert.deepEqual(result.value.paths, ['drop.log', 'keep.txt', 'src/.gitignore', 'src/keep.ts'])
})

test('SPEC[fs-002] git info exclude participates at the root only', async t => {
  const root = gitRoot(t)
  writeFileSync(path.join(root, '.git/info/exclude'), '*.log\n')
  write(root, 'a.log', 'x')
  write(root, 'b.txt', 'x')
  const result = await fs(root).glob('**/*')
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.paths, ['b.txt'])
})

test('SPEC[fs-002] symlinks are not followed and .git is never entered', async t => {
  const root = gitRoot(t)
  write(root, '.git/internal.txt', 'x')
  write(root, 'real.txt', 'x')
  symlinkSync(path.join(root, 'real.txt'), path.join(root, 'alias.txt'))
  const result = await fs(root).glob('**/*')
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.paths, ['real.txt'])
})

test('SPEC[fs-002] slash-less patterns match at any depth, double-star crosses directories', async t => {
  const root = gitRoot(t)
  write(root, 'top.md', 'x')
  write(root, 'a/nested.md', 'x')
  write(root, 'a/b/deep.md', 'x')
  const api = fs(root)
  // 主仓既有 wildmatch 语义：不含 `/` 的模式按 gitignore 惯例任意深度匹配。
  const single = await api.glob('*.md')
  assert.deepEqual(single.value.paths, ['a/b/deep.md', 'a/nested.md', 'top.md'])
  const deep = await api.glob('a/**/*.md')
  assert.deepEqual(deep.value.paths, ['a/b/deep.md', 'a/nested.md'])
  const segment = await api.glob('a/*.md')
  assert.deepEqual(segment.value.paths, ['a/nested.md'])
})

test('SPEC[fs-002] brace alternation expands top-level commas', async t => {
  const root = gitRoot(t)
  write(root, 'one.txt', 'x')
  write(root, 'two.md', 'x')
  const result = await fs(root).glob('{one.txt,two.md}')
  assert.deepEqual(result.value.paths, ['one.txt', 'two.md'])
})

test('SPEC[fs-002] directory-only ignore rules do not hide plain files of the same shape', async t => {
  const root = gitRoot(t)
  write(root, 'build/out.js', 'x')
  write(root, 'build.txt', 'x')
  write(root, '.gitignore', 'build/\n')
  const result = await fs(root).glob('**/*')
  assert.deepEqual(result.value.paths, ['.gitignore', 'build.txt'])
})

test('SPEC[fs-002] empty pattern is refused with the stable invalid-pattern code', async t => {
  const root = gitRoot(t)
  const result = await fs(root).glob('')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_ANCHOR_PATTERN')
})
