import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { runProcess, largeGate } from 'wanxiangli/runtime'

const request = (script = '', extra = {}) => ({
  command: { fileName: process.execPath, args: ['-e', script] },
  estimate: { runtimeSeconds: 10, outputBytes: 65536n, memory: 'medium' },
  ...extra,
})
const directory = t => {
  const value = mkdtempSync(path.join(tmpdir(), 'wanxiangli-process-run-'))
  t.after(() => rmSync(value, { recursive: true, force: true }))
  return value
}
const completed = result => { assert.equal(result.ok, true, result.error?.reason); assert.equal(result.value.kind, 'Completed'); return result.value }

// 只替换测试进程的原生边界；产品入口不接收可变 ChildProcess 或 launcher。
async function controlled(config, action) {
  const originalSpawn = childProcess.spawn
  const originalKill = process.kill
  const child = new EventEmitter()
  child.pid = 2147483647
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = new EventEmitter()
  const writes = []
  const kills = []
  let spawnCount = 0
  let closed = false
  const close = (code = 0, signal = null) => {
    if (!closed) { closed = true; child.emit('exit', code, signal); child.emit('close', code, signal) }
  }
  child.stdin.write = (bytes, callback) => {
    writes.push(Buffer.from(bytes))
    if (config.write) config.write(bytes, callback, close)
    else queueMicrotask(() => callback(null))
  }
  child.stdin.end = () => { child.stdin.emit('finish'); config.end?.(child, close) }
  childProcess.spawn = () => {
    spawnCount++
    queueMicrotask(() => { child.emit('spawn'); config.start?.(child, close) })
    return child
  }
  process.kill = (pid, signal) => {
    assert.equal(pid, -child.pid)
    kills.push(signal)
    config.kill?.(child, close)
    return true
  }
  syncBuiltinESMExports()
  try { return await action({ child, close, writes, kills, spawnCount: () => spawnCount }) }
  finally {
    close()
    await new Promise(setImmediate)
    childProcess.spawn = originalSpawn
    process.kill = originalKill
    syncBuiltinESMExports()
  }
}

test('a real run preserves separate streams, UTF-8 and nonzero exit as data', async () => {
  const result = completed(await runProcess(request('process.stdout.write("hello世界"); process.stderr.write("diagnostic"); process.exitCode=3')))
  assert.deepEqual(result, { kind: 'Completed', exitCode: 3, stdout: 'hello世界', stderr: 'diagnostic', spooled: false })
})

test('estimates reject only the old invalid time and negative output cases before spawning', async () => {
  await controlled({}, async child => {
    for (const runtimeSeconds of [NaN, Infinity, -Infinity, 0, -1]) {
      const result = await runProcess(request('', { estimate: { runtimeSeconds, outputBytes: 1n, memory: 'large' } }))
      assert.deepEqual(result, { ok: false, error: { kind: 'ExecutionFailed', reason: 'deadline_seconds must be a finite positive number' } })
    }
    const result = await runProcess(request('', { estimate: { runtimeSeconds: 1, outputBytes: -1n, memory: 'medium' } }))
    assert.deepEqual(result, { ok: false, error: { kind: 'ExecutionFailed', reason: 'output_budget_bytes must be non-negative' } })
    assert.equal(child.spawnCount(), 0)
  })
})

test('cwd precedence, inherited environment, filtering and PATH preparation retain their existing rules', async t => {
  const root = directory(t)
  const fallback = path.join(root, 'fallback'); mkdirSync(fallback)
  const report = 'process.stdout.write(JSON.stringify({cwd:process.cwd(),env:process.env}))'
  const env = { WANXIANGLI_PROCESS_RUN: 'child', 'BAD=KEY': 'ignored', ['NUL\0KEY']: 'ignored',
    BADVALUE: 'bad\0value', ['__proto__']: 'ignored', BACKSLASH: 'literal\\0value', ['BACK\\0KEY']: 'literal' }
  const original = process.env.WANXIANGLI_PROCESS_RUN
  process.env.WANXIANGLI_PROCESS_RUN = 'parent'
  try {
    const normal = completed(await runProcess(request(report, { context: { cwd: fallback } })))
    assert.equal(JSON.parse(normal.stdout).cwd, realpathSync(fallback))
    const chosen = completed(await runProcess(request('', {
      command: { fileName: process.execPath, args: ['-e', report], cwd: '', env }, context: { cwd: fallback },
    })))
    const parsed = JSON.parse(chosen.stdout)
    assert.equal(parsed.cwd, process.cwd())
    assert.equal(parsed.env.WANXIANGLI_PROCESS_RUN, 'child')
    assert.equal(Object.hasOwn(parsed.env, 'BAD=KEY'), false)
    assert.equal(Object.hasOwn(parsed.env, 'BADVALUE'), false)
    assert.equal(Object.hasOwn(parsed.env, 'NUL\0KEY'), false)
    assert.equal(Object.hasOwn(parsed.env, '__proto__'), false)
    assert.equal(parsed.env.BACKSLASH, 'literal\\0value')
    assert.equal(parsed.env['BACK\\0KEY'], 'literal')
    const bin = path.join(root, 'relative'); mkdirSync(bin)
    writeFileSync(path.join(bin, 'tool'), '#!/bin/sh\nprintf resolved', { mode: 0o700 })
    const absolute = completed(await runProcess(request('', { command: { fileName: 'tool', args: [], env: { PATH: bin } } })))
    assert.equal(absolute.stdout, 'resolved')
    const cwd = process.cwd()
    try {
      process.chdir(root)
      const relative = await runProcess(request('', { command: { fileName: 'tool', args: [], cwd: fallback, env: { PATH: 'relative' } } }))
      assert.equal(relative.error.kind, 'SpawnFailed')
      assert.match(relative.error.reason, /executable must be absolute/)
    } finally { process.chdir(cwd) }
  } finally {
    if (original === undefined) delete process.env.WANXIANGLI_PROCESS_RUN
    else process.env.WANXIANGLI_PROCESS_RUN = original
  }
})

test('stdin is UTF-8 encoded and acknowledged in sequential 16 MiB chunks', async () => {
  await controlled({ end: (child, close) => { child.stdout.emit('data', Buffer.from('received')); close() } }, async child => {
    const input = 'a'.repeat(16777216) + '世界🧭'
    const result = completed(await runProcess(request('', { command: { fileName: '/test-command', args: [], stdin: input } })))
    assert.equal(result.stdout, 'received')
    assert.deepEqual(child.writes.map(part => part.length), [16777216, Buffer.byteLength('世界🧭')])
    assert.deepEqual(Buffer.concat(child.writes), Buffer.from(input))
  })
})

test('unknown stdin consumption is not retried and a later zero exit cannot replace the failure', async () => {
  await controlled({
    write: (_bytes, callback) => queueMicrotask(() => callback(new Error('input delivery unknown'))),
    kill: (_child, close) => close(0),
  }, async child => {
    const result = await runProcess(request('', { command: { fileName: '/test-command', args: [], stdin: 'x'.repeat(16777217) } }))
    assert.equal(result.error.kind, 'ExecutionFailed')
    assert.equal(result.error.reason, 'input delivery unknown')
    assert.equal(child.writes.length, 1)
  })
})

test('a real stdin pipe failure cannot become a successful incomplete run', async () => {
  const result = await runProcess(request('', { command: {
    fileName: process.execPath, args: ['-e', 'require("node:fs").closeSync(0); setTimeout(() => process.exit(0), 100)'],
    stdin: 'x'.repeat(2 * 1024 * 1024),
  } }))
  assert.equal(result.error.kind, 'ExecutionFailed')
  assert.match(result.error.reason, /EPIPE|pipe|closed|write/i)
})

test('32 MiB output plus UTF-8 and invalid bytes is fully spooled even with a huge estimate', async t => {
  const spoolDirectory = directory(t)
  const tail = Buffer.concat([Buffer.from([255]), Buffer.from('最后的原始输出🧭\n')])
  const script = 'const fs=require("node:fs");const b=Buffer.alloc(1048576,97);for(let i=0;i<32;i++)fs.writeSync(1,b);fs.writeSync(1,Buffer.from([255]));fs.writeSync(1,Buffer.from("最后的原始输出🧭\\n"))'
  const result = await runProcess(request(script, {
    estimate: { runtimeSeconds: 10, outputBytes: 9223372036854775807n, memory: 'medium' }, context: { spoolDirectory },
  }))
  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'Spooled')
  const bytes = readFileSync(result.value.spoolPath)
  const expected = createHash('sha256')
  for (let index = 0; index < 32; index++) expected.update(Buffer.alloc(1048576, 97))
  expected.update(tail)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.digest('hex'))
  assert.equal(result.value.totalBytes, BigInt(bytes.length))
  assert.equal(result.value.chunkCount, Math.ceil(bytes.length / 204800))
})

test('spooled streams retain callback arrival order and ignore output after settlement', async t => {
  const spoolDirectory = directory(t)
  await controlled({ start: (child, close) => {
    child.stdout.emit('data', Buffer.from('A')); child.stderr.emit('data', Buffer.from('B')); child.stdout.emit('data', Buffer.from('C')); close(7)
  } }, async child => {
    const result = await runProcess(request('', { estimate: { runtimeSeconds: 1, outputBytes: 2n, memory: 'medium' }, context: { spoolDirectory } }))
    assert.equal(result.value.kind, 'Spooled')
    assert.equal(result.value.exitCode, 7)
    assert.equal(result.value.totalBytes, 3n)
    assert.equal(readFileSync(result.value.spoolPath, 'utf8'), 'ABC')
    child.child.stdout.emit('data', Buffer.from('late'))
    assert.equal(readFileSync(result.value.spoolPath, 'utf8'), 'ABC')
  })
})

test('spool failure reports its operation and incomplete byte counts', async t => {
  const spoolDirectory = path.join(directory(t), 'missing')
  const result = await runProcess(request('process.stdout.write("abcdef")', {
    estimate: { runtimeSeconds: 1, outputBytes: 0n, memory: 'medium' }, context: { spoolDirectory },
  }))
  assert.equal(result.error.kind, 'ExecutionFailed')
  assert.match(result.error.reason, /output spool open failed \(ENOENT: .* after 0 of 6 bytes; process exit code 0, output incomplete/)
})

test('the deadline uses min(estimate, hard limit) and waits for actual close after kill', async () => {
  for (const [runtimeSeconds, hardLimitMs, expected] of [[0.03, 1000, 30], [10, 40, 40]]) {
    let closed = false
    await controlled({ kill: (_child, close) => setTimeout(() => { closed = true; close(137) }, 15) }, async () => {
      const result = await runProcess(request('', { estimate: { runtimeSeconds, outputBytes: 1n, memory: 'medium' }, context: { hardLimitMs } }))
      assert.equal(closed, true)
      assert.deepEqual(result, { ok: false, error: { kind: 'TimeoutExceeded', durationMs: expected } })
    })
  }
})

test('unconfirmed close ends after the 1000 ms grace, discards spool and ignores late bytes', async t => {
  const spoolDirectory = directory(t)
  await controlled({ start: child => child.stdout.emit('data', Buffer.from('before timeout')) }, async child => {
    const before = performance.now()
    const result = await runProcess(request('', { estimate: { runtimeSeconds: 0.02, outputBytes: 0n, memory: 'medium' }, context: { spoolDirectory } }))
    assert.equal(result.error.kind, 'TimeoutExceeded')
    assert.ok(performance.now() - before >= 900)
    assert.deepEqual(readdirSync(spoolDirectory), [])
    child.child.stdout.emit('data', Buffer.from('late'))
    assert.deepEqual(readdirSync(spoolDirectory), [])
  })
})

test('pre-cancelled Medium returns SpawnFailed while pre-cancelled or queued Large rejects without releasing another permit', async () => {
  const controller = new AbortController(); controller.abort()
  await controlled({}, async child => {
    assert.deepEqual(await runProcess(request(), controller.signal), { ok: false, error: { kind: 'SpawnFailed', reason: 'Cancelled before spawn' } })
    const large = request('', { estimate: { runtimeSeconds: 1, outputBytes: 1n, memory: 'large' } })
    await assert.rejects(runProcess(large, controller.signal), { name: 'AbortError' })
    assert.equal(largeGate.getCount(), 1)
    await largeGate.acquire()
    try {
      const queued = new AbortController()
      const pending = runProcess(large, queued.signal)
      queued.abort()
      await assert.rejects(pending, { name: 'AbortError' })
      assert.equal(largeGate.getCount(), 0)
    } finally { largeGate.release() }
    assert.equal(largeGate.getCount(), 1)
    assert.equal(child.spawnCount(), 0)
  })
})

test('cancellation during startup or waiting is ProcessCancelled and does not wait for close', async t => {
  const spoolDirectory = directory(t)
  for (const startup of [true, false]) {
    const controller = new AbortController()
    await controlled({ start: child => {
      child.stdout.emit('data', Buffer.from('started'))
      if (startup) controller.abort()
      else setTimeout(() => controller.abort(), 25)
    } }, async child => {
      const result = await runProcess(request('', { context: { spoolDirectory }, estimate: { runtimeSeconds: 1, outputBytes: 0n, memory: 'medium' } }), controller.signal)
      assert.deepEqual(result, { ok: false, error: { kind: 'ProcessCancelled', reason: 'Cancelled by token' } })
      assert.ok(child.kills.length > 0)
      assert.deepEqual(readdirSync(spoolDirectory), [])
    })
  }
})

test('cancelling during kill acknowledgement remains cancellation and the first pipe failure survives exit zero', async () => {
  const controller = new AbortController()
  await controlled({ kill: () => controller.abort() }, async () => {
    const result = await runProcess(request('', { estimate: { runtimeSeconds: 0.01, outputBytes: 1n, memory: 'medium' } }), controller.signal)
    assert.equal(result.error.kind, 'ProcessCancelled')
  })
  await controlled({ start: child => {
    child.stdout.emit('error', new Error('first pipe failure'))
    child.stderr.emit('error', new Error('later failure'))
  }, kill: (_child, close) => close(0) }, async () => {
    const result = await runProcess(request())
    assert.equal(result.error.kind, 'ExecutionFailed')
    assert.equal(result.error.reason, 'first pipe failure')
  })
})

test('Large permits are held only by admitted runs and released after success, spawn failure or preparation exception', async () => {
  const estimate = { runtimeSeconds: 1, outputBytes: 1024n, memory: 'large' }
  await controlled({ start: (_child, close) => { assert.equal(largeGate.getCount(), 0); close(5) } }, async () => {
    assert.equal(completed(await runProcess(request('', { estimate }))).exitCode, 5)
    assert.equal(largeGate.getCount(), 1)
  })
  const absent = await runProcess(request('', { command: { fileName: '/nonexistent-wanxiang-command', args: [] }, estimate }))
  assert.equal(absent.error.kind, 'SpawnFailed')
  assert.equal(largeGate.getCount(), 1)
  const controller = new AbortController()
  const env = { get throw() { throw new Error('preparation failure') } }
  const failed = await runProcess(request('', { command: { fileName: '/unused', args: [], env }, estimate }))
  assert.equal(failed.error.reason, 'preparation failure')
  assert.equal(largeGate.getCount(), 1)
  const aborting = { get throw() { controller.abort(); throw new Error('preparation failure') } }
  const cancelled = await runProcess(request('', { command: { fileName: '/unused', args: [], env: aborting } }), controller.signal)
  assert.equal(cancelled.error.kind, 'ProcessCancelled')
})
