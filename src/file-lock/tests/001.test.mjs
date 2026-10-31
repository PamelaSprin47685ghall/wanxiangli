import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { acquire, isAcquireTimeout } from '../../../dist/file-lock/FileLock.js'

const require = createRequire(new URL('../../../dist/file-lock/FileLock.js', import.meta.url))
const lockCore = require('proper-lockfile/lib/lockfile.js')
const retryModule = createRequire(require.resolve('proper-lockfile'))('retry')
const retry = (retries = 0) => ({ kind: 'Retry', retries, minTimeoutMs: 1, maxTimeoutMs: 1, factor: 1 })
const budget = budgetMs => ({ kind: 'Budget', budgetMs })
function target(t) {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'wanxiangli-file-lock-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return path.join(directory, 'resource')
}
function existingLock(file, owner, stale = false) {
  fs.mkdirSync(file + '.lock')
  if (owner !== undefined) fs.writeFileSync(path.join(file + '.lock', 'owner.json'), typeof owner === 'string' ? owner : JSON.stringify(owner))
  if (stale) fs.utimesSync(file + '.lock', new Date(0), new Date(0))
}
const contention = cause => cause.code === 'ELOCKED'

test('真实锁目录保存 owner，释放可重复且不公开底层能力', async t => {
  const file = target(t)
  const lease = await acquire(file, retry())
  assert.deepEqual(Object.keys(lease), ['release'])
  const owner = JSON.parse(fs.readFileSync(path.join(file + '.lock', 'owner.json'), 'utf8'))
  assert.equal(owner.pid, process.pid)
  assert.equal(typeof owner.time, 'number')
  await assert.rejects(acquire(file, retry()), contention)
  await lease.release()
  assert.equal(fs.existsSync(file + '.lock'), false)
  await lease.release()
  const next = await acquire(file, budget(100))
  await next.release()
})

test('独立进程在首持有者释放之前不能取得锁，之后取得', { timeout: 10000 }, async t => {
  const file = target(t)
  const first = await acquire(file, retry())
  const child = spawn(process.execPath, [new URL('./support/lock-child.mjs', import.meta.url).pathname, file], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', text => { stderr += text })
  const messages = []
  let wake
  child.on('message', message => { messages.push(message); wake?.() })
  const exited = once(child, 'exit')
  const nextMessage = async expected => {
    while (!messages.length) await new Promise(resolve => { wake = resolve })
    assert.equal(messages.shift(), expected, stderr)
  }
  try {
    await nextMessage('contended')
    assert.equal(JSON.parse(fs.readFileSync(path.join(file + '.lock', 'owner.json'))).pid, process.pid)
    await first.release()
    await nextMessage('acquired')
    assert.equal(JSON.parse(fs.readFileSync(path.join(file + '.lock', 'owner.json'))).pid, child.pid)
    child.send('release')
    await nextMessage('released')
    assert.equal((await exited)[0], 0, stderr)
  } finally {
    await first.release()
    if (child.exitCode === null && child.signalCode === null) {
      child.send('release')
      await exited
    }
  }
})

test('Retry 将 EIO/EACCES 交给原 retry，Budget 原对象立即抛出', async t => {
  for (const code of ['EIO', 'EACCES']) {
    const file = target(t)
    const cause = Object.assign(new Error(code), { code, syscall: 'mkdir', path: file + '.lock' })
    const original = fs.mkdirSync
    let attempts = 0
    fs.mkdirSync = function (candidate, ...rest) {
      if (candidate === file + '.lock') { attempts++; throw cause }
      return original.call(this, candidate, ...rest)
    }
    try {
      await assert.rejects(acquire(file, retry(2)), error => error === cause)
      assert.equal(attempts, 3)
      attempts = 0
      await assert.rejects(acquire(file, budget(100)), error => error === cause)
      assert.equal(attempts, 1)
      assert.equal(isAcquireTimeout(cause), false)
    } finally { fs.mkdirSync = original }
  }
})

test('Budget 竞争耗尽携带路径/次数/时间；零预算不开始获取', async t => {
  const file = target(t)
  const held = await acquire(file, retry())
  try {
    const originalNow = Date.now
    const originalOperation = retryModule.operation
    let now = Date.now()
    Date.now = () => now
    retryModule.operation = function (...args) {
      const operation = originalOperation.apply(this, args)
      const originalRetry = operation.retry
      operation.retry = function (error) {
        if (error?.code === 'ELOCKED') now += 100
        return originalRetry.call(this, error)
      }
      return operation
    }
    try {
      await assert.rejects(acquire(file, budget(100)), error => {
        assert.ok(error instanceof Error)
        assert.equal(isAcquireTimeout(error), true)
        assert.equal(error.name, 'FileLockAcquireTimeout')
        assert.equal(error.path, file)
        assert.equal(error.attempts, 1)
        assert.equal(error.waitedMs, 100)
        assert.equal(isAcquireTimeout({ ...error }), false)
        return true
      })
    } finally { Date.now = originalNow; retryModule.operation = originalOperation }
    await assert.rejects(acquire(file, budget(0)), error => isAcquireTimeout(error) && error.attempts === 0)
    await assert.rejects(acquire(file, retry(1)), contention)
  } finally { await held.release() }
  for (const value of [null, undefined, 1, 'FileLockAcquireTimeout', new Error('unrelated')]) assert.equal(isAcquireTimeout(value), false)
})

test('已退出进程的 fresh owner 按原 mtime=0 路径回收', async t => {
  const file = target(t)
  const processResult = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' })
  assert.equal(processResult.status, 0)
  const pid = Number(processResult.stdout.trim())
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH')
  existingLock(file, { pid, time: Date.now() })
  const lease = await acquire(file, retry())
  try { assert.equal(JSON.parse(fs.readFileSync(path.join(file + '.lock', 'owner.json'))).pid, process.pid) }
  finally { await lease.release() }
})

test('活 PID 不掩盖 stale 心跳；缺损 owner 回落到文件时间', async t => {
  for (const owner of [{ pid: process.pid }, undefined, '{broken']) {
    const file = target(t)
    existingLock(file, owner)
    await assert.rejects(acquire(file, retry()), contention)
    fs.utimesSync(file + '.lock', new Date(0), new Date(0))
    const lease = await acquire(file, retry())
    await lease.release()
  }
})

test('owner 写入/读取故障忽略；EPERM 表示 PID 仍存在', async t => {
  const file = target(t)
  const originalWrite = fs.writeFileSync
  fs.writeFileSync = function (candidate, ...rest) {
    if (candidate === path.join(file + '.lock', 'owner.json')) throw Object.assign(new Error('owner write'), { code: 'EIO' })
    return originalWrite.call(this, candidate, ...rest)
  }
  let lease
  try { lease = await acquire(file, retry()) }
  finally { fs.writeFileSync = originalWrite }
  assert.equal(fs.existsSync(path.join(file + '.lock', 'owner.json')), false)
  await lease.release()
  existingLock(file, { pid: 123456789 })
  const originalKill = process.kill
  process.kill = function (pid, signal) {
    if (pid === 123456789 && signal === 0) throw Object.assign(new Error('not permitted'), { code: 'EPERM' })
    return originalKill.call(this, pid, signal)
  }
  try { await assert.rejects(acquire(file, retry()), contention) }
  finally { process.kill = originalKill }
  const originalRead = fs.readFileSync
  fs.readFileSync = function (candidate, ...rest) {
    if (candidate === path.join(file + '.lock', 'owner.json')) throw Object.assign(new Error('owner read'), { code: 'EIO' })
    return originalRead.call(this, candidate, ...rest)
  }
  try { await assert.rejects(acquire(file, retry()), contention) }
  finally { fs.readFileSync = originalRead }
})

test('第一次释放失败保留错误身份，重复释放不重试', async t => {
  const file = target(t)
  const lease = await acquire(file, retry())
  const cause = Object.assign(new Error('release EIO'), { code: 'EIO', path: file + '.lock' })
  const original = fs.rmSync
  let removals = 0
  fs.rmSync = function (candidate, ...rest) {
    if (candidate === file + '.lock') { removals++; throw cause }
    return original.call(this, candidate, ...rest)
  }
  try {
    const first = lease.release()
    await lease.release()
    await assert.rejects(first, error => error === cause)
    await lease.release()
    assert.equal(removals, 1)
    assert.equal(fs.existsSync(file + '.lock'), true)
  } finally { fs.rmSync = original }
})

test('并发重复释放不等待首次未完成的底层清理', async t => {
  const file = target(t)
  const original = lockCore.lock
  const entered = Promise.withResolvers()
  let finish
  lockCore.lock = function (candidate, options, callback) {
    return original(candidate, options, (error, release) => {
      if (error) return callback(error)
      callback(null, complete => { finish = () => release(complete); entered.resolve() })
    })
  }
  let lease
  try { lease = await acquire(file, retry()) }
  finally { lockCore.lock = original }
  const first = lease.release()
  try {
    await entered.promise
    await lease.release()
    assert.equal(fs.existsSync(file + '.lock'), true)
  } finally { finish(); await first }
  assert.equal(fs.existsSync(file + '.lock'), false)
})
