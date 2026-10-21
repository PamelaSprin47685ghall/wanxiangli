import test from 'node:test'
import assert from 'node:assert/strict'

import { GitPorcelain } from 'wanxiangli/git-porcelain'

const g = GitPorcelain()

const LISTING = [
  'worktree /repo',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /repo/.wt/j1',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/manager/j1',
  '',
  'worktree /repo/.wt/detached',
  'HEAD 3333333333333333333333333333333333333333',
  'detached',
  '',
].join('\n')

test('SPEC[git-porcelain-1] worktree records are split on the empty line and keep the full ref', () => {
  const entries = g.worktrees(LISTING)
  assert.deepEqual(entries.map((e) => ({ ...e })), [
    { path: '/repo', branch: 'refs/heads/main' },
    { path: '/repo/.wt/j1', branch: 'refs/heads/manager/j1' },
    { path: '/repo/.wt/detached', branch: null },
  ])
  assert.ok(Object.isFrozen(entries[0]))
})

test('SPEC[git-porcelain-1] a CRLF listing is read like the LF listing (CR is not a record separator)', () => {
  // Counterexample of the old host reader, which split on both CR and LF and so
  // closed every record after its `worktree` line: the manager branch was lost and
  // the cleanup sweep could not recognise its own worktree.
  assert.deepEqual(
    g.worktrees(LISTING.replaceAll('\n', '\r\n')).map((e) => ({ ...e })),
    g.worktrees(LISTING).map((e) => ({ ...e })),
  )
})

test('SPEC[git-porcelain-1] a last record without a trailing empty line is kept; output without records is empty', () => {
  assert.deepEqual(g.worktrees('worktree /a\nbranch refs/heads/x').map((e) => ({ ...e })), [
    { path: '/a', branch: 'refs/heads/x' },
  ])
  assert.deepEqual([...g.worktrees('')], [])
  assert.deepEqual([...g.worktrees('branch refs/heads/orphan\n\n')], [])
})

test('SPEC[git-porcelain-2] branch list markers are not part of the name', () => {
  assert.deepEqual([...g.branches('* main\n+ manager/j1\n  manager/j2\n\n')], ['main', 'manager/j1', 'manager/j2'])
  assert.deepEqual([...g.branches('')], [])
})

test('SPEC[git-porcelain-3] manager branch identity with or without refs/heads/', () => {
  assert.equal(g.managerBranchOf('j1'), 'manager/j1')
  assert.equal(g.isManagerBranch('refs/heads/manager/j1'), true)
  assert.equal(g.isManagerBranch('manager/j1'), true)
  assert.equal(g.isManagerBranch('refs/heads/main'), false, 'the main working tree is never a manager worktree')
  assert.equal(g.isManagerBranch('refs/heads/x/manager/j1'), false)
  assert.equal(g.shortBranch('refs/heads/manager/j1'), 'manager/j1')
  assert.equal(g.shortBranch('manager/j1'), 'manager/j1')
})

test('SPEC[git-porcelain-4] only successful, non-blank rev-parse probes are rebase state candidates', () => {
  assert.deepEqual([...g.rebaseStatePaths({ code: 0, path: '.git/rebase-merge\n' }, { code: 0, path: ' ' })], ['.git/rebase-merge'])
  assert.deepEqual([...g.rebaseStatePaths({ code: 128, path: '.git/rebase-merge' }, { code: 1, path: 'x' })], [])
  assert.throws(() => g.rebaseStatePaths(null, { code: 0, path: 'x' }), /requires \{ code, path \}/)
})

test('SPEC[git-porcelain-5] primary worktree of the -z listing; bare and malformed fail closed', () => {
  const z = (records) => records.map((r) => r.join('\0') + '\0').join('\0')
  assert.deepEqual({ ...g.primaryWorktree(z([['worktree /repo', 'HEAD 1', 'branch refs/heads/main'], ['worktree /repo/.wt/j1', 'HEAD 2']])) }, { ok: true, path: '/repo' })
  assert.deepEqual({ ...g.primaryWorktree(z([['worktree /repo.git', 'bare']])) }, { ok: false, code: 'bare' })
  assert.deepEqual({ ...g.primaryWorktree('HEAD 1\0\0') }, { ok: false, code: 'unidentified' })
  assert.deepEqual({ ...g.primaryWorktree('') }, { ok: false, code: 'unidentified' })
})

test('SPEC[git-porcelain] non-string input is refused, not coerced', () => {
  assert.throws(() => g.worktrees(undefined), /requires string output/)
  assert.throws(() => g.branches(42), /requires string output/)
})

test('SPEC[git-porcelain-2] worktree cleanup: only unowned manager branches are stale; primary and detached never are', () => {
  const entries = g.worktrees(LISTING + 'worktree /repo/.wt/j2\nHEAD 4444444444444444444444444444444444444444\nbranch refs/heads/manager/j2\n')
  assert.deepEqual([...g.staleWorktrees(entries, ['manager/j1'])], ['/repo/.wt/j2'])
  assert.deepEqual([...g.staleWorktrees(entries, ['manager/j1', 'manager/j2'])], [])
  // the main working tree is on refs/heads/main: never classified stale even with nothing owned
  assert.deepEqual([...g.staleWorktrees(entries, [])], ['/repo/.wt/j1', '/repo/.wt/j2'])
  // ownership compares the whole short name; a job id prefix is not ownership
  assert.deepEqual([...g.staleWorktrees(entries, ['manager/j'])], ['/repo/.wt/j1', '/repo/.wt/j2'])
  assert.deepEqual([...g.staleBranches(['manager/j1', 'refs/heads/manager/j2', 'manager/j3'], ['manager/j2'])], ['manager/j1', 'manager/j3'])
  assert.throws(() => g.staleBranches('manager/j1', []), /string array/)
})
