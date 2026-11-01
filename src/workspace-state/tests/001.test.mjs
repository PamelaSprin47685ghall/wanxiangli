import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { primaryDirectory, primaryDirectorySync, checkStateDirectory, initializeStateDirectory } from '../../../dist/workspace-state/WorkspaceState.js'
import { runtimePathStore } from 'wanxiangli/git-porcelain'

function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'wanxiangli-workspace-state-')))
  t.after(() => { runtimePathStore.clear(); fs.rmSync(directory, { recursive: true, force: true }) })
  return directory
}
function git(directory, ...args) {
  return childProcess.execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
function repository(t) {
  const base = fixture(t)
  const repo = path.join(base, 'repo')
  fs.mkdirSync(repo)
  git(repo, 'init', '--initial-branch=main')
  git(repo, '-c', 'user.name=State test', '-c', 'user.email=state@example.invalid', 'commit', '--allow-empty', '-m', 'fixture')
  return { base, repo }
}
async function both(workspace, expected) {
  assert.equal(await primaryDirectory(workspace), expected)
  assert.equal(primaryDirectorySync(workspace), expected)
}
async function rejected(workspace, predicate) {
  await assert.rejects(primaryDirectory(workspace), predicate)
  assert.throws(() => primaryDirectorySync(workspace), predicate)
}
function mockQueries(asyncQuery, syncQuery) {
  const originalAsync = childProcess.execFile
  const originalSync = childProcess.execFileSync
  childProcess.execFile = asyncQuery
  childProcess.execFileSync = syncQuery
  syncBuiltinESMExports()
  return () => {
    childProcess.execFile = originalAsync
    childProcess.execFileSync = originalSync
    syncBuiltinESMExports()
  }
}

test('主/linked/nested 工作树共用主目录，查询不写状态或 Git 配置', async t => {
  const { base, repo } = repository(t)
  const linked = path.join(base, 'linked')
  git(repo, 'worktree', 'add', '--detach', linked)
  const nested = path.join(linked, 'nested')
  fs.mkdirSync(nested)
  const config = fs.readFileSync(path.join(repo, '.git', 'config'))
  for (const entry of [repo, linked, nested]) await both(entry, repo)
  assert.equal(fs.existsSync(path.join(repo, '.Herdchestra')), false)
  assert.deepEqual(fs.readFileSync(path.join(repo, '.git', 'config')), config)
})

test('现存非 Git 目录回退自身并规范化别名，missing 只用 Git 父目录', async t => {
  const { base, repo } = repository(t)
  const plain = path.join(base, 'plain')
  fs.mkdirSync(plain)
  const alias = path.join(base, 'alias')
  fs.symlinkSync(plain, alias, 'dir')
  await both(plain, plain)
  await both(alias, plain)
  await both(path.join(repo, 'missing'), repo)
  await rejected(path.join(plain, 'missing'), /missing workspace/)
  const vanished = path.join(plain, 'vanished')
  fs.mkdirSync(vanished)
  await both(vanished, vanished)
  fs.rmdirSync(vanished)
  await rejected(vanished, /missing workspace/)
  await rejected(path.join(repo, 'missing', 'deeper'), error => error.code === 'ENOENT')
  const file = path.join(base, 'file')
  fs.writeFileSync(file, 'data')
  await rejected(file, /must be a directory/)
  await rejected(' ', /required/)
  const broken = path.join(base, 'broken')
  fs.symlinkSync(path.join(base, 'absent'), broken, 'dir')
  await rejected(broken, error => error.code === 'ENOENT')
})

test('bare、直接和经符号链接进入 .git 的 workspace 均拒绝', async t => {
  const { base, repo } = repository(t)
  const bare = path.join(base, 'bare')
  fs.mkdirSync(bare)
  git(bare, 'init', '--bare')
  await rejected(bare, /bare repository/)
  await rejected(path.join(repo, '.git'), /inside .git/)
  const alias = path.join(base, 'metadata-alias')
  fs.symlinkSync(path.join(repo, '.git'), alias, 'dir')
  await rejected(alias, /inside .git/)
})

test('专用 argv/env 一致；只有明确 128 notgit 回退，其他原错误保留', async t => {
  const directory = fixture(t)
  let failure = Object.assign(new Error('notgit'), { code: 128, status: 128, stderr: 'fatal: not a git repository (or any parent)' })
  const inspect = (executable, args, options) => {
    assert.equal(executable, 'git')
    assert.deepEqual(args, ['-C', directory, 'worktree', 'list', '--porcelain', '-z'])
    assert.equal(options.cwd, undefined)
    assert.equal(options.encoding, 'utf8')
    assert.equal(options.env.LC_ALL, 'C')
    assert.equal(options.env.GIT_OPTIONAL_LOCKS, '0')
  }
  const restore = mockQueries((executable, args, options, callback) => {
    inspect(executable, args, options)
    callback(failure, '', failure.stderr)
  }, (executable, args, options) => { inspect(executable, args, options); throw failure })
  try {
    await both(directory, directory)
    for (const cause of [
      Object.assign(new Error('permission'), { code: 128, status: 128, stderr: 'fatal: permission denied' }),
      Object.assign(new Error('notgit wrong status'), { code: 1, status: 1, stderr: 'fatal: not a git repository' }),
      Object.assign(new Error('missing executable'), { code: 'ENOENT', path: 'git' }),
    ]) {
      runtimePathStore.clear()
      failure = cause
      await rejected(directory, error => error === cause)
    }
  } finally { restore() }
})

test('成功但无法识别的 Git 输出不回退', async t => {
  const directory = fixture(t)
  const restore = mockQueries((_executable, _args, _options, callback) => callback(null, '', ''), () => '')
  try { await rejected(directory, /did not identify/)}
  finally { restore() }
})

test('异步只用现有缓存，失败可再查，同步不等待缓存中的 Promise', async t => {
  const directory = fixture(t)
  const output = `worktree ${directory}\0\0`
  let callback
  let asyncCount = 0
  let syncCount = 0
  const restore = mockQueries((_executable, _args, _options, complete) => { asyncCount++; callback = complete }, () => { syncCount++; return output })
  try {
    const first = primaryDirectory(directory)
    assert.equal(runtimePathStore.has(directory), true)
    assert.equal(primaryDirectorySync(directory), directory)
    assert.equal(syncCount, 1)
    const cause = Object.assign(new Error('temporary'), { code: 'EIO' })
    callback(cause, '', '')
    await assert.rejects(first, error => error === cause)
    assert.equal(runtimePathStore.has(directory), false)
    const second = primaryDirectory(directory)
    callback(null, output, '')
    assert.equal(await second, directory)
    assert.equal(await primaryDirectory(directory), directory)
    assert.equal(asyncCount, 2)
  } finally { restore() }
})

test('宿主决定目录名；检查只读，初始化仅写自身忽略文件', t => {
  const directory = fixture(t)
  const state = path.join(directory, 'host-chosen-state')
  assert.equal(checkStateDirectory(state), state)
  assert.equal(fs.existsSync(state), false)
  assert.equal(initializeStateDirectory(state), state)
  const ignore = path.join(state, '.gitignore')
  assert.equal(fs.readFileSync(ignore, 'utf8'), '*\n')
  fs.writeFileSync(ignore, '  * \n')
  assert.equal(initializeStateDirectory(state), state)
  assert.equal(fs.readFileSync(ignore, 'utf8'), '  * \n')
})

test('状态文件/链接/.git 与指入 .git 的父目录均不能改写落盘位置', t => {
  const directory = fixture(t)
  const metadata = path.join(directory, '.git')
  fs.mkdirSync(metadata)
  const file = path.join(directory, 'file')
  fs.writeFileSync(file, 'keep')
  const link = path.join(directory, 'link')
  fs.symlinkSync(directory, link, 'dir')
  for (const candidate of [file, link]) {
    assert.throws(() => checkStateDirectory(candidate), /real directory/)
    assert.throws(() => initializeStateDirectory(candidate), /real directory/)
  }
  const alias = path.join(directory, 'metadata-alias')
  fs.symlinkSync(metadata, alias, 'dir')
  for (const candidate of [metadata, path.join(alias, 'state')]) {
    assert.throws(() => checkStateDirectory(candidate), /inside .git/)
    assert.throws(() => initializeStateDirectory(candidate), /inside .git/)
  }
  assert.throws(() => checkStateDirectory(path.join(directory, 'missing', 'state')), error => error.code === 'ENOENT')
  assert.equal(fs.existsSync(path.join(metadata, 'state')), false)
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep')
})

test('已有非法忽略文件、目录或符号链接拒绝且不覆盖', t => {
  const directory = fixture(t)
  for (const kind of ['content', 'directory', 'symlink']) {
    const state = path.join(directory, kind)
    fs.mkdirSync(state)
    const ignore = path.join(state, '.gitignore')
    if (kind === 'content') fs.writeFileSync(ignore, 'other\n')
    if (kind === 'directory') fs.mkdirSync(ignore)
    if (kind === 'symlink') fs.symlinkSync(path.join(directory, 'other'), ignore, 'file')
    assert.throws(() => initializeStateDirectory(state), /regular file/)
    if (kind === 'content') assert.equal(fs.readFileSync(ignore, 'utf8'), 'other\n')
    if (kind === 'symlink') assert.equal(fs.existsSync(path.join(directory, 'other')), false)
  }
})
