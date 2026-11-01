import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { execFile, execFileSync } from 'node:child_process'
import { GitWorktrees } from 'wanxiangli/git'

const output = (code = 0, stdout = '', stderr = '') => ({ code, stdout, stderr })
const ok = { ok: true, value: undefined }
const failure = error => ({ ok: false, error })
function harness(respond = () => output()) {
  const calls = []
  const service = new GitWorktrees('/bound repo', command => { calls.push(command); return Promise.resolve(respond(command, calls.length)) })
  return { service, calls }
}

test('命令保持 argv 与绑定仓库；remove 不提供 cwd', async () => {
  const { service, calls } = harness()
  const created = await service.create('feature/exact', '/new tree', 'refs/heads/base')
  assert.equal(created.ok, true)
  assert.equal(created.value.path, '/new tree')
  assert.equal(created.value.identity, 'feature/exact')
  assert.deepEqual(await service.remove('/old tree'), ok)
  await service.list()
  await service.listBranches('custom/*')
  assert.deepEqual(await service.deleteBranch('feature/exact'), ok)
  assert.deepEqual(calls, [
    { cwd: '/bound repo', args: ['worktree', 'add', '/new tree', '-b', 'feature/exact', 'refs/heads/base'] },
    { args: ['worktree', 'remove', '--force', '/old tree'] },
    { cwd: '/bound repo', args: ['worktree', 'list', '--porcelain'] },
    { cwd: '/bound repo', args: ['branch', '--list', 'custom/*'] },
    { cwd: '/bound repo', args: ['branch', '-D', 'feature/exact'] },
  ])
  const otherCalls = []
  const other = new GitWorktrees('/other', async command => { otherCalls.push(command); return output() })
  await other.deleteBranch('another')
  assert.equal(otherCalls[0].cwd, '/other')
  assert.equal(Object.hasOwn(service, 'repo'), false)
  assert.equal(Object.hasOwn(service, 'run'), false)
})

test('列举复用公开 porcelain，保留完整身份与 detached null', async () => {
  const { service } = harness(command => command.args[0] === 'worktree'
    ? output(0, 'worktree /primary\nHEAD abc\nbranch refs/heads/main\n\nworktree /second\nHEAD def\nbranch refs/heads/feature/exact\n\nworktree /detached\nHEAD ghi\ndetached\n')
    : output(0, '  main\n+ feature/exact\n* custom/topic\n'))
  assert.deepEqual(await service.list(), { ok: true, value: [
    { path: '/primary', identity: 'refs/heads/main' },
    { path: '/second', identity: 'refs/heads/feature/exact' },
    { path: '/detached', identity: null },
  ] })
  assert.deepEqual(await service.listBranches('*'), { ok: true, value: ['main', 'feature/exact', 'custom/topic'] })
})

test('非零退出保留诊断字节，创建失败不产生资源', async () => {
  for (const [stdout, stderr, expected] of [
    ['stdout\n', 'stderr\n', 'stderr\n'],
    ['stdout\n', ' \t\n\u2003', 'stdout\n'],
  ]) {
    const { service, calls } = harness(() => output(7, stdout, stderr))
    assert.deepEqual(await service.create('id', '/path', 'HEAD'), failure(expected))
    assert.deepEqual(await service.remove('/path'), failure(expected))
    assert.deepEqual(await service.list(), failure(expected))
    assert.deepEqual(await service.listBranches('x/*'), failure(expected))
    assert.deepEqual(await service.deleteBranch('id'), failure(expected))
    assert.equal(calls.length, 5)
  }
})

test('create 默认自动清理；两步成功后重复 release/dispose 不再执行', async () => {
  const { service, calls } = harness()
  const resource = (await service.create('id', '/path', 'HEAD')).value
  assert.deepEqual(Object.keys(resource), ['path', 'identity', 'markDurable', 'release', 'dispose'])
  assert.equal(Object.isFrozen(resource), true)
  assert.throws(() => { resource.path = '/other' }, TypeError)
  await resource.dispose()
  assert.deepEqual(calls.slice(1).map(command => command.args), [['worktree', 'remove', '--force', '/path'], ['branch', '-D', 'id']])
  assert.deepEqual(await resource.release(), ok)
  await resource.dispose()
  assert.equal(calls.length, 3)
})

test('adopt 默认保留且不创建，markDurable 只关自动清理', async () => {
  const { service, calls } = harness()
  const adopted = service.adopt('renamed/existing', '/moved/path')
  await adopted.dispose()
  assert.equal(calls.length, 0)
  assert.equal(adopted.identity, 'renamed/existing')
  assert.deepEqual(await adopted.release(), ok)
  const created = (await service.create('new', '/new', 'HEAD')).value
  created.markDurable()
  await created.dispose()
  assert.equal(calls.length, 3)
  assert.deepEqual(await created.release(), ok)
  assert.equal(calls.length, 5)
})

test('remove 返回 Error 仍删分支，错误组合沿用旧文字', async () => {
  for (const [left, right, expected] of [
    [output(1, '', 'left\n'), output(1, '', 'right\n'), 'worktree=left\n; branch=right\n'],
    [output(1, '', 'left'), output(), 'worktree=left'],
    [output(), output(1, '', 'right'), 'branch=right'],
  ]) {
    const { service, calls } = harness((_command, count) => count % 2 === 1 ? left : right)
    const resource = service.adopt('id', '/path')
    assert.deepEqual(await resource.release(), failure(expected))
    assert.deepEqual(await resource.release(), failure(expected))
    assert.equal(calls.length, 4)
  }
})

test('部分失败后再次释放重做两步，成功后才停止', async () => {
  const { service, calls } = harness((_command, count) => count === 2 ? output(1, '', 'branch busy') : output())
  const resource = service.adopt('id', '/path')
  assert.deepEqual(await resource.release(), failure('branch=branch busy'))
  assert.deepEqual(await resource.release(), ok)
  assert.deepEqual(await resource.release(), ok)
  assert.deepEqual(calls.map(command => command.args[0]), ['worktree', 'branch', 'worktree', 'branch'])
})

test('remove throw/reject 原对象传播并停止，删除分支异常保留且可重试', async () => {
  const cause = new Error('native runner failure')
  for (const asynchronous of [false, true]) {
    const { service, calls } = harness(() => {
      if (asynchronous) return Promise.reject(cause)
      throw cause
    })
    await assert.rejects(service.adopt('id', '/path').release(), error => error === cause)
    await assert.rejects(service.create('id', '/path', 'HEAD'), error => error === cause)
    assert.equal(calls.length, 2)
    assert.equal(calls.some(command => command.args[0] === 'branch'), false)
  }
  const { service, calls } = harness((_command, count) => { if (count === 2) throw cause; return output() })
  const resource = service.adopt('id', '/path')
  await assert.rejects(resource.release(), error => error === cause)
  assert.deepEqual(await resource.release(), ok)
  assert.equal(calls.length, 4)
})

test('dispose 吞返回错误与异常，不把失败记为 released', async () => {
  for (const throws of [false, true]) {
    const { service, calls } = harness((_command, count) => {
      if (count > 1) {
        if (throws) throw new Error('dispose failure')
        return output(1, '', 'dispose failure')
      }
      return output()
    })
    const resource = (await service.create('id', '/path', 'HEAD')).value
    await resource.dispose()
    const after = calls.length
    await resource.dispose()
    assert.ok(calls.length > after)
  }
})

test('并发 release 沿用独立执行，不悄悄变成串行或共享 Promise', async () => {
  const gates = [Promise.withResolvers(), Promise.withResolvers()]
  const entered = Promise.withResolvers()
  let removes = 0
  const { service, calls } = harness(command => {
    if (command.args[0] !== 'worktree') return output()
    const gate = gates[removes++]
    if (removes === 2) entered.resolve()
    return gate.promise
  })
  const resource = service.adopt('id', '/path')
  const first = resource.release()
  const second = resource.release()
  try {
    await entered.promise
    assert.notEqual(first, second)
    assert.equal(removes, 2)
  } finally {
    for (const gate of gates) gate.resolve(output())
    assert.deepEqual(await first, ok)
    assert.deepEqual(await second, ok)
  }
  assert.equal(calls.filter(command => command.args[0] === 'branch').length, 2)
})

test('真实 Git 创建与清理保留源工作区草稿，保留后可接管再释放', async t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'wanxiangli-git-worktrees-')))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const repo = path.join(directory, 'repo')
  fs.mkdirSync(repo)
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('init', '--initial-branch=main')
  fs.writeFileSync(path.join(repo, 'tracked'), 'committed\n')
  git('add', 'tracked')
  git('-c', 'user.name=Worktree test', '-c', 'user.email=worktree@example.invalid', 'commit', '-m', 'fixture')
  fs.writeFileSync(path.join(repo, 'tracked'), 'local edit\n')
  fs.writeFileSync(path.join(repo, 'draft'), 'untracked draft\n')
  const run = command => new Promise((resolve, reject) => {
    execFile('git', command.args, { cwd: command.cwd ?? repo, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') reject(error)
      else resolve(output(error?.code ?? 0, stdout, stderr))
    })
  })
  const service = new GitWorktrees(repo, run)
  const created = await service.create('feature/topic', path.join(directory, 'linked'), 'HEAD')
  assert.equal(created.ok, true, created.error)
  const resource = created.value
  assert.equal(fs.readFileSync(path.join(resource.path, 'tracked'), 'utf8'), 'committed\n')
  assert.equal(fs.existsSync(path.join(resource.path, 'draft')), false)
  assert.ok((await service.list()).value.some(entry => entry.identity === 'refs/heads/feature/topic'))
  assert.deepEqual((await service.listBranches('feature/*')).value, ['feature/topic'])
  resource.markDurable()
  await resource.dispose()
  assert.equal(fs.existsSync(resource.path), true)
  const adopted = service.adopt(resource.identity, resource.path)
  await adopted.dispose()
  assert.equal(fs.existsSync(resource.path), true)
  assert.deepEqual(await adopted.release(), ok)
  assert.equal(fs.existsSync(resource.path), false)
  assert.deepEqual((await service.listBranches('feature/*')).value, [])
  assert.equal(fs.readFileSync(path.join(repo, 'tracked'), 'utf8'), 'local edit\n')
  assert.equal(fs.readFileSync(path.join(repo, 'draft'), 'utf8'), 'untracked draft\n')
})
