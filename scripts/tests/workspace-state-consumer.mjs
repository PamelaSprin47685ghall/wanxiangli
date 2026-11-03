import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { primaryDirectory, primaryDirectorySync, checkStateDirectory, initializeStateDirectory } from 'wanxiangli/workspace-state'

const directory = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'wanxiangli-workspace-state-consumer-')))
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
try {
  const repo = path.join(directory, 'repo')
  fs.mkdirSync(repo)
  git(repo, 'init', '--initial-branch=main')
  git(repo, '-c', 'user.name=State consumer', '-c', 'user.email=state@example.invalid', 'commit', '--allow-empty', '-m', 'fixture')
  const linked = path.join(directory, 'linked')
  git(repo, 'worktree', 'add', '--detach', linked)
  assert.equal(await primaryDirectory(linked), repo)
  assert.equal(primaryDirectorySync(linked), repo)
  const root = path.join(await primaryDirectory(linked), '.Herdchestra')
  assert.equal(checkStateDirectory(root), root)
  assert.equal(fs.existsSync(root), false)
  assert.equal(initializeStateDirectory(root), root)
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), '*\n')
  assert.equal(fs.existsSync(path.join(linked, '.Herdchestra')), false)
  const plain = path.join(directory, 'plain')
  fs.mkdirSync(plain)
  assert.equal(await primaryDirectory(plain), plain)
  assert.equal(primaryDirectorySync(plain), plain)
  await assert.rejects(primaryDirectory(path.join(plain, 'missing')), /missing workspace/)
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
console.log('workspace-state consumer passed')
