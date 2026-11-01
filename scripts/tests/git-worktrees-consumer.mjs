import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { execFile, execFileSync } from 'node:child_process'
import { GitWorktrees } from 'wanxiangli/git'

const directory = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'wanxiangli-git-worktrees-consumer-')))
try {
  const repo = path.join(directory, 'repo')
  fs.mkdirSync(repo)
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('init', '--initial-branch=main')
  fs.writeFileSync(path.join(repo, 'tracked'), 'committed\n')
  git('add', 'tracked')
  git('-c', 'user.name=Worktree consumer', '-c', 'user.email=worktree@example.invalid', 'commit', '-m', 'fixture')
  fs.writeFileSync(path.join(repo, 'tracked'), 'local edit\n')
  fs.writeFileSync(path.join(repo, 'draft'), 'draft\n')
  const commands = []
  const service = new GitWorktrees(repo, command => new Promise((resolve, reject) => {
    commands.push(command)
    execFile('git', command.args, { cwd: command.cwd ?? repo, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') reject(error)
      else resolve({ code: error?.code ?? 0, stdout, stderr })
    })
  }))
  const automatic = await service.create('auto-clean', path.join(directory, 'automatic'), 'HEAD')
  assert.equal(automatic.ok, true, automatic.error)
  await automatic.value.dispose()
  assert.equal(fs.existsSync(automatic.value.path), false)
  assert.deepEqual((await service.listBranches('auto-*')).value, [])
  const created = await service.create('retained/topic', path.join(directory, 'retained'), 'HEAD')
  assert.equal(created.ok, true, created.error)
  const resource = created.value
  assert.equal(fs.readFileSync(path.join(resource.path, 'tracked'), 'utf8'), 'committed\n')
  assert.equal(fs.existsSync(path.join(resource.path, 'draft')), false)
  assert.ok((await service.list()).value.some(entry => entry.identity === 'refs/heads/retained/topic'))
  resource.markDurable()
  await resource.dispose()
  assert.equal(fs.existsSync(resource.path), true)
  const adopted = service.adopt(resource.identity, resource.path)
  await adopted.dispose()
  assert.equal(fs.existsSync(resource.path), true)
  assert.deepEqual(await adopted.release(), { ok: true, value: undefined })
  assert.equal(fs.existsSync(resource.path), false)
  assert.deepEqual((await service.listBranches('retained/*')).value, [])
  assert.ok(commands.filter(command => command.args[0] === 'worktree' && command.args[1] === 'remove').every(command => !Object.hasOwn(command, 'cwd')))
  assert.equal(fs.readFileSync(path.join(repo, 'tracked'), 'utf8'), 'local edit\n')
  assert.equal(fs.readFileSync(path.join(repo, 'draft'), 'utf8'), 'draft\n')
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
console.log('git-worktrees consumer passed')
