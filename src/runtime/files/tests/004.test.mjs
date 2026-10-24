import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { workspace, fs, write } from './support.mjs'

const rewrite = (path, originalText, newText) => ({ kind: 'rewrite', path, originalText, newText })
const create = (path, text) => ({ kind: 'create', path, text })

test('SPEC[fs-004] the same path mutated twice is refused before any file effect', t => {
  const root = workspace(t)
  write(root, 'a.txt', 'alpha')
  const result = fs(root).applyCommit([rewrite('a.txt', 'alpha', 'one'), rewrite('a.txt', 'alpha', 'two')])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'DUPLICATE_MUTATION_TARGET')
  assert.equal(readFileSync(path.join(root, 'a.txt'), 'utf8'), 'alpha')
})

test('SPEC[fs-004] preflight detects an externally changed snapshot and refuses with zero writes', t => {
  const root = workspace(t)
  write(root, 'a.txt', 'before')
  write(root, 'b.txt', 'beta')
  const api = fs(root)
  const result = api.preflight(
    ['a.txt', 'b.txt'],
    { 'a.txt': 'after', 'b.txt': 'beta' },
    [{ path: 'a.txt', text: 'before' }],
    [rewrite('a.txt', 'before', 'next')]
  )
  assert.equal(result.ok, false)
  assert.equal(result.code, 'FILE_CHANGED')
  assert.match(result.reason, /a\.txt/)
})

test('SPEC[fs-004] a rewrite whose original text no longer matches disk is refused, third-party bytes survive', t => {
  const root = workspace(t)
  write(root, 'a.txt', 'mine')
  const api = fs(root)
  const result = api.applyCommit([rewrite('a.txt', 'mine', 'theirs')])
  write(root, 'a.txt', 'external-edit')
  const stale = api.applyCommit([rewrite('a.txt', 'mine', 'theirs')])
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'FILE_CHANGED')
  assert.equal(readFileSync(path.join(root, 'a.txt'), 'utf8'), 'external-edit')
  assert.equal(result.ok, true)
})

test('SPEC[fs-004] create refuses when the target already exists', t => {
  const root = workspace(t)
  write(root, 'exists.txt', 'present')
  const result = fs(root).applyCommit([create('exists.txt', 'other')])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'FILE_CHANGED')
  assert.equal(readFileSync(path.join(root, 'exists.txt'), 'utf8'), 'present')
})

test('SPEC[fs-004] a failing second write rolls the first write back to its original bytes', t => {
  const root = workspace(t)
  write(root, 'first.txt', 'first-original')
  const second = write(root, 'second.txt', 'second-original')
  chmodSync(second, 0o444)
  const api = fs(root)
  try {
    const result = api.applyCommit([rewrite('first.txt', 'first-original', 'first-new'), rewrite('second.txt', 'second-original', 'second-new')])
    assert.equal(result.ok, false)
    assert.equal(result.code, 'TRANSACTION_COMMIT_FAILED')
    assert.equal(readFileSync(path.join(root, 'first.txt'), 'utf8'), 'first-original')
  } finally {
    chmodSync(second, 0o644)
  }
})

test('SPEC[fs-004] rollback restores only content the transaction itself wrote', t => {
  const root = workspace(t)
  write(root, 'a.txt', 'original')
  const api = fs(root)
  assert.equal(api.applyCommit([rewrite('a.txt', 'original', 'new')]).ok, true)
  writeFileSync(path.join(root, 'a.txt'), 'third-party')
  api.undoIfMatches('a.txt', 'new', 'original')
  assert.equal(readFileSync(path.join(root, 'a.txt'), 'utf8'), 'third-party')
  api.undoIfMatches('a.txt', 'third-party', 'original')
  assert.equal(readFileSync(path.join(root, 'a.txt'), 'utf8'), 'original')
})

test('SPEC[fs-004] applyRollback removes created files and restores rewritten ones', t => {
  const root = workspace(t)
  write(root, 'a.txt', 'original')
  const api = fs(root)
  assert.equal(api.applyCommit([rewrite('a.txt', 'original', 'new'), create('made.txt', 'fresh')]).ok, true)
  api.applyRollback([rewrite('a.txt', 'original', 'new'), create('made.txt', 'fresh')])
  assert.equal(readFileSync(path.join(root, 'a.txt'), 'utf8'), 'original')
  assert.equal(api.existsPath(path.join(root, 'made.txt')), false)
})

test('SPEC[fs-004] commit and rollback plans are deterministic and path-ordered', t => {
  const root = workspace(t)
  const api = fs(root)
  const mutations = [create('z.txt', 'z'), rewrite('a.txt', 'old', 'new')]
  const commit = api.commitPlan(mutations)
  assert.deepEqual(commit.value.map(entry => entry.path), ['a.txt', 'z.txt'])
  const rollback = api.rollbackPlan(mutations)
  assert.deepEqual(rollback.value.map(entry => entry.path), ['z.txt', 'a.txt'])
  assert.equal(rollback.value.find(entry => entry.path === 'a.txt').originalText, 'old')
})
