import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { execFile, execFileSync } from 'node:child_process'
import { GitPublication } from 'wanxiangli/git-publication'

const directory = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'wanxiangli-git-publication-consumer-')))
try {
  const repo = path.join(directory, 'repo')
  const candidate = path.join(directory, 'candidate')
  fs.mkdirSync(repo)
  const env = { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' }
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '--initial-branch=main')
  git('config', 'user.name', 'Publication consumer')
  git('config', 'user.email', 'publication@example.invalid')
  git('config', 'core.hooksPath', '/dev/null')
  git('config', 'commit.gpgsign', 'false')
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n')
  git('add', 'base.txt')
  git('commit', '-m', 'base')
  git('worktree', 'add', '-b', 'candidate', candidate, 'HEAD')

  const service = new GitPublication(repo, command => new Promise((resolve, reject) => {
    execFile('git', command.args, { cwd: command.cwd ?? repo, encoding: 'utf8', env }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') reject(error)
      else resolve({ code: error?.code ?? 0, stdout, stderr })
    })
  }))
  const target = await service.targetHead('main')
  assert.equal(target.ok, true, target.error)
  const branch = await service.currentBranch()
  assert.equal(branch.ok, true, branch.error)
  assert.equal(branch.value, 'main')
  fs.writeFileSync(path.join(candidate, 'result.txt'), 'published bytes\n')
  const prepared = await service.prepare(candidate, 'consumer candidate')
  assert.equal(prepared.ok, true, prepared.error)
  const pinned = await service.readHead(candidate)
  assert.equal(pinned.ok, true, pinned.error)
  assert.equal(git('-C', candidate, 'log', '-1', '--format=%s'), 'consumer candidate')
  const repeated = await service.prepare(candidate, 'no additional commit')
  assert.equal(repeated.ok, true, repeated.error)
  assert.deepEqual(await service.readHead(candidate), pinned)
  const published = await service.fastForward({ worktree: candidate, target: 'main', expectedHead: target.value, candidate: pinned.value })
  assert.equal(published.ok, true, published.error)
  assert.equal(published.value, pinned.value)
  assert.equal(git('rev-parse', 'HEAD'), pinned.value)
  assert.equal(fs.readFileSync(path.join(repo, 'result.txt'), 'utf8'), 'published bytes\n')

  const originalError = new Error('consumer runner failure')
  const rejected = new GitPublication(repo, () => Promise.reject(originalError))
  await assert.rejects(rejected.readHead(candidate), cause => cause === originalError)
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
console.log('git-publication consumer passed')
