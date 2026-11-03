import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { execFile, execFileSync } from 'node:child_process'
import { GitPublication } from 'wanxiangli/git'

const output = (code = 0, stdout = '', stderr = '') => ({ code, stdout, stderr })
const ok = { ok: true, value: undefined }
const failed = error => ({ ok: false, error, code: 'failed' })
function harness(respond = command => command.args[0] === 'grep' ? output(1) : output()) {
  const calls = []
  const service = new GitPublication('/repo', command => { calls.push(command); return Promise.resolve(respond(command, calls.length)) })
  return { service, calls }
}
const args = calls => calls.map(command => command.args)
function temporary(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'wanxiangli-git-publication-')))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}
function rebaseResponder(directory) {
  return command => {
    if (command.args[0] === 'grep') return output(1)
    if (command.args.join(' ') === 'rev-parse --git-path rebase-merge') return output(0, directory + '\n')
    return output()
  }
}
const request = { worktree: '/worktree', target: 'main', expectedHead: 'before', candidate: 'candidate' }
const ffArgs = [
  ['rev-parse', 'HEAD'], ['symbolic-ref', '--short', 'HEAD'], ['rev-parse', 'refs/heads/main'],
  ['merge-base', '--is-ancestor', 'before', 'candidate'], ['status', '--porcelain'],
  ['merge', '--ff-only', 'candidate'], ['rev-parse', 'HEAD'],
]
function ffOutput(command) {
  const text = command.args.join(' ')
  if (text === 'rev-parse HEAD') return output(0, 'candidate\n')
  if (text === 'symbolic-ref --short HEAD') return output(0, 'main\n')
  if (text === 'rev-parse refs/heads/main') return output(0, 'before\n')
  return output()
}

test('dirtyPaths 保留普通 porcelain/rename 读法与未修饰诊断', async () => {
  const { service, calls } = harness(() => output(0, ' M file\nR  old -> new path\r\n?? "quoted name"\n?? \nX\n'))
  assert.deepEqual(await service.dirtyPaths('/tree'), { ok: true, value: ['file', 'new path', '"quoted name"'] })
  assert.deepEqual(calls, [{ cwd: '/tree', args: ['status', '--porcelain'] }])
  for (const [stdout, stderr, expected] of [['out\n', 'err\n', 'err\n'], ['out\n', ' \t\n', 'out\n']]) {
    assert.deepEqual(await harness(() => output(1, stdout, stderr)).service.dirtyPaths('/tree'), failed(expected))
  }
})

test('当前分支和 HEAD 查询保持 trim、空输出与 stderr 规则', async () => {
  const { service, calls } = harness(command => {
    if (command.args[0] === 'symbolic-ref') return output(0, ' main\n')
    return output(0, ' hash\n')
  })
  assert.deepEqual(await service.currentBranch(), { ok: true, value: 'main' })
  assert.deepEqual(await service.readHead('/tree'), { ok: true, value: 'hash' })
  assert.deepEqual(await service.targetHead('topic'), { ok: true, value: 'hash' })
  assert.deepEqual(calls, [
    { cwd: '/repo', args: ['symbolic-ref', '--short', 'HEAD'] },
    { cwd: '/tree', args: ['rev-parse', 'HEAD'] },
    { cwd: '/repo', args: ['rev-parse', 'refs/heads/topic'] },
  ])
  const blank = harness(() => output(0, ' \n')).service
  assert.deepEqual(await blank.currentBranch(), failed('cannot freeze target branch: repository HEAD is detached'))
  assert.deepEqual(await blank.readHead('/tree'), failed('HEAD is empty'))
  assert.deepEqual(await blank.targetHead('gone'), failed('target branch not found: gone'))
  assert.deepEqual(await harness(() => output(1, 'ignored', ' detail\n')).service.readHead('/tree'), failed('detail'))
})

test('conflictedPaths 保留路径行原文和错误通道选择', async () => {
  const { service, calls } = harness(() => output(0, 'one\r\n padded \n\ntwo\r'))
  assert.deepEqual(await service.conflictedPaths('/tree'), { ok: true, value: ['one', ' padded ', 'two'] })
  assert.deepEqual(calls[0], { cwd: '/tree', args: ['diff', '--name-only', '--diff-filter=U'] })
  assert.deepEqual(await harness(() => output(1, 'fallback\n', '')).service.conflictedPaths('/tree'), failed('fallback\n'))
})

test('rebase 只识别成功探针中的实际目录，始终先查两种目录', async t => {
  const directory = temporary(t)
  const file = path.join(directory, 'REBASE_HEAD')
  fs.writeFileSync(file, 'stale')
  const { service, calls } = harness(rebaseResponder(file))
  assert.equal(await service.rebaseInProgress('/tree'), false)
  assert.deepEqual(args(calls), [['rev-parse', '--git-path', 'rebase-merge'], ['rev-parse', '--git-path', 'rebase-apply']])
  assert.equal(await harness(rebaseResponder(directory)).service.rebaseInProgress('/tree'), true)
  assert.equal(await harness(() => output(1, directory)).service.rebaseInProgress('/tree'), false)
})

test('新 rebase 清旧引用后执行；非零删除结果忽略，实际 rebase 错误保留', async () => {
  const { service, calls } = harness(command => {
    if (command.args[0] === 'update-ref') return output(1, '', 'ignored')
    if (command.args[0] === 'rebase') return output(1, 'rebase stdout\n', '')
    return output()
  })
  assert.deepEqual(await service.rebase('/tree', 'main'), failed('rebase stdout\n'))
  assert.deepEqual(args(calls), [
    ['rev-parse', '--git-path', 'rebase-merge'], ['rev-parse', '--git-path', 'rebase-apply'],
    ['update-ref', '-d', 'REBASE_HEAD'], ['rebase', 'main'],
  ])
  assert.ok(calls.every(command => command.cwd === '/tree'))
})

test('独立 rebase continue 先 stage 一次，stage 失败忽略 stdout', async t => {
  const directory = temporary(t)
  for (const addFails of [false, true]) {
    const base = rebaseResponder(directory)
    const { service, calls } = harness(command => {
      if (command.args[0] === 'add' && addFails) return output(1, 'ignored stdout', '')
      if (command.args[0] === '-c') return output(1, 'continue stdout', '')
      return base(command)
    })
    assert.deepEqual(await service.rebase('/tree', 'main'), failed(addFails ? '' : 'continue stdout'))
    assert.deepEqual(args(calls).slice(2), addFails ? [['add', '-A']] : [['add', '-A'], ['-c', 'core.editor=true', 'rebase', '--continue']])
  }
})

test('prepare 顺序为 stage/检查/探针/清引用/commit，message 原文传入', async () => {
  const message = 'supplied message\nsecond line'
  const { service, calls } = harness(command => command.args[0] === 'grep' ? output(1) : output())
  assert.deepEqual(await service.prepare('/tree', message), ok)
  assert.deepEqual(args(calls), [
    ['add', '-A'], ['diff', '--name-only', '--diff-filter=U'],
    ['grep', '-I', '-n', '-E', '^<<<<<<< |^>>>>>>> ', '--', '.'],
    ['rev-parse', '--git-path', 'rebase-merge'], ['rev-parse', '--git-path', 'rebase-apply'],
    ['update-ref', '-d', 'REBASE_HEAD'], ['commit', '-m', message],
  ])
  assert.ok(calls.every(command => command.cwd === '/tree'))
})

test('prepare 在途 continue 不重复 stage，错误沿用 prepare 专用文字', async t => {
  const base = rebaseResponder(temporary(t))
  const { service, calls } = harness(command => command.args[0] === '-c' ? output(1, 'ignored stdout', 'detail\n') : base(command))
  assert.deepEqual(await service.prepare('/tree', 'message'), failed('git rebase --continue failed: detail\n'))
  assert.equal(calls.filter(command => command.args[0] === 'add').length, 1)
  assert.deepEqual(calls.at(-1).args, ['-c', 'core.editor=true', 'rebase', '--continue'])
  assert.equal(calls.some(command => command.args[0] === 'commit'), false)
})

test('prepare 每个前置失败都停止后续命令，nothing to commit 单独成功', async () => {
  for (const [step, result, message] of [
    [1, output(1, 'ignored', 'add error'), 'git add failed: add error'],
    [2, output(1, 'ignored', 'scan error'), 'conflict scan failed: scan error'],
    [2, output(0, ' a\n'), 'unmerged paths remain after stage: a'],
    [3, output(0, ' file:1:<<<<<<< old\n'), 'conflict markers remain in worktree:\nfile:1:<<<<<<< old'],
    [3, output(2, '', 'ignored'), 'conflict-marker scan failed'],
    [7, output(1, 'ignored', 'commit error'), 'git commit failed: commit error'],
  ]) {
    const { service, calls } = harness((command, count) => count === step ? result : command.args[0] === 'grep' ? output(1) : output())
    assert.deepEqual(await service.prepare('/tree', 'message'), failed(message))
    assert.equal(calls.length, step)
  }
  for (const result of [output(1, 'nothing to commit\n'), output(1, '', 'nothing to commit')]) {
    assert.deepEqual(await harness(command => command.args[0] === 'commit' ? result : command.args[0] === 'grep' ? output(1) : output()).service.prepare('/tree', 'message'), ok)
  }
})

test('fastForward 固定 pin 并完整按序验证，最后读取实际 HEAD', async () => {
  const { service, calls } = harness(ffOutput)
  assert.deepEqual(await service.fastForward(request), { ok: true, value: 'candidate' })
  assert.deepEqual(args(calls), ffArgs)
  assert.equal(calls[0].cwd, '/worktree')
  assert.ok(calls.slice(1).every(command => command.cwd === '/repo'))
})

test('fastForward 每个失败停止；expectedHead 和旧 ref-moved 文本标为 target-moved', async () => {
  for (const [step, result, expectedCode, text] of [
    [1, output(0, 'other'), 'failed', /does not match pinned/],
    [1, output(1), 'failed', /candidate HEAD is empty/],
    [2, output(0, 'other'), 'failed', /publish branch mismatch/],
    [2, output(1, 'ignored', 'ignored'), 'failed', /<detached HEAD>/],
    [3, output(1), 'failed', /target branch not found/],
    [3, output(0, 'moved'), 'target-moved', /changed/],
    [4, output(1), 'failed', /not a fast-forward/],
    [5, output(1, 'status failure'), 'failed', /status failure/],
    [5, output(0, ' M dirty\nR  old -> renamed\n'), 'failed', /dirty, renamed/],
    [6, output(1, '', 'merge failed'), 'failed', /merge failed/],
    [6, output(1, '', 'cannot lock ref'), 'target-moved', /cannot lock ref/],
    [6, output(1, 'UPDATE-REF failed'), 'target-moved', /UPDATE-REF/],
    [6, output(1, '', 'unexpected expected value'), 'target-moved', /expected value/],
    [7, output(0, 'wrong'), 'failed', /did not advance HEAD/],
    [7, output(1, 'verify failure'), 'failed', /verify failure/],
  ]) {
    const { service, calls } = harness((command, count) => count === step ? result : ffOutput(command))
    const actual = await service.fastForward(request)
    assert.equal(actual.ok, false)
    assert.equal(actual.code, expectedCode)
    assert.match(actual.error, text)
    assert.equal(calls.length, step)
  }
})

test('runner throw/reject 原对象传播，包括含 nothing-to-commit 文本的异常', async () => {
  for (const asynchronous of [false, true]) {
    const cause = new Error('nothing to commit is still a thrown failure')
    const { service } = harness(() => { if (asynchronous) return Promise.reject(cause); throw cause })
    for (const call of [
      () => service.dirtyPaths('/tree'), () => service.currentBranch(), () => service.readHead('/tree'),
      () => service.targetHead('main'), () => service.rebaseInProgress('/tree'), () => service.rebase('/tree', 'main'),
      () => service.conflictedPaths('/tree'), () => service.prepare('/tree', 'message'), () => service.fastForward(request),
    ]) await assert.rejects(call(), error => error === cause)
  }
})

function realFixture(t) {
  const directory = temporary(t)
  const repo = path.join(directory, 'repo')
  fs.mkdirSync(repo)
  const git = (cwd, ...arguments_) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', cwd, ...arguments_], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(repo, 'init', '--initial-branch=main')
  git(repo, 'config', 'user.name', 'Publication test')
  git(repo, 'config', 'user.email', 'publication@example.invalid')
  fs.writeFileSync(path.join(repo, 'tracked'), 'base\n')
  git(repo, 'add', '-A'); git(repo, 'commit', '-m', 'base')
  const expected = git(repo, 'rev-parse', 'HEAD')
  const worktree = path.join(directory, 'linked')
  git(repo, 'worktree', 'add', '-b', 'topic', worktree, 'HEAD')
  const calls = []
  const service = new GitPublication(repo, command => new Promise((resolve, reject) => {
    calls.push(command)
    execFile('git', command.args, { cwd: command.cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') reject(error)
      else resolve(output(error?.code ?? 0, stdout, stderr))
    })
  }))
  return { directory, repo, worktree, git, expected, calls, service }
}

test('真实 prepare/无改动成功、脏目标拒绝保留草稿与固定候选 FF', async t => {
  const { repo, worktree, git, expected, service } = realFixture(t)
  fs.writeFileSync(path.join(worktree, 'tracked'), 'candidate\n')
  assert.deepEqual(await service.prepare(worktree, 'supplied candidate message'), ok)
  const candidate = git(worktree, 'rev-parse', 'HEAD')
  assert.equal(git(worktree, 'log', '-1', '--format=%s'), 'supplied candidate message')
  assert.deepEqual(await service.prepare(worktree, 'no new commit'), ok)
  assert.equal(git(worktree, 'rev-parse', 'HEAD'), candidate)
  const publish = { worktree, target: 'main', expectedHead: expected, candidate }
  fs.writeFileSync(path.join(repo, 'draft'), 'keep draft\n')
  assert.equal((await service.fastForward(publish)).ok, false)
  assert.equal(git(repo, 'rev-parse', 'HEAD'), expected)
  assert.equal(fs.readFileSync(path.join(repo, 'draft'), 'utf8'), 'keep draft\n')
  fs.unlinkSync(path.join(repo, 'draft'))
  assert.deepEqual(await service.fastForward(publish), { ok: true, value: candidate })
  assert.equal(fs.readFileSync(path.join(repo, 'tracked'), 'utf8'), 'candidate\n')
})

test('真实冲突标记拒绝候选提交', async t => {
  const { worktree, git, expected, service } = realFixture(t)
  fs.writeFileSync(path.join(worktree, 'tracked'), '<<<<<<< ours\nvalue\n>>>>>>> theirs\n')
  const result = await service.prepare(worktree, 'must not commit')
  assert.equal(result.ok, false)
  assert.match(result.error, /conflict markers remain/)
  assert.equal(git(worktree, 'rev-parse', 'HEAD'), expected)
})

test('真实在途 rebase 的 prepare/rebase 两条继续路径各只 stage 一次', async t => {
  for (const operation of ['prepare', 'rebase']) {
    const { repo, worktree, git, calls, service } = realFixture(t)
    fs.writeFileSync(path.join(worktree, 'tracked'), 'topic\n')
    git(worktree, 'add', '-A'); git(worktree, 'commit', '-m', 'topic change')
    fs.writeFileSync(path.join(repo, 'tracked'), 'main\n')
    git(repo, 'add', '-A'); git(repo, 'commit', '-m', 'main change')
    assert.throws(() => git(worktree, 'rebase', 'main'))
    assert.equal(await service.rebaseInProgress(worktree), true)
    fs.writeFileSync(path.join(worktree, 'tracked'), 'resolved\n')
    calls.length = 0
    assert.deepEqual(await service[operation](worktree, operation === 'prepare' ? 'ignored' : 'main'), ok)
    assert.equal(calls.filter(command => command.args[0] === 'add').length, 1)
    assert.equal(await service.rebaseInProgress(worktree), false)
    assert.equal(fs.readFileSync(path.join(worktree, 'tracked'), 'utf8'), 'resolved\n')
    assert.equal(fs.readFileSync(path.join(repo, 'tracked'), 'utf8'), 'main\n')
  }
})
