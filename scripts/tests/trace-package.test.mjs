import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const { NODE_PATH, NODE_OPTIONS, ...env } = process.env
const succeed = result => {
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result.stdout
}

test('SPEC[build-005] installed trace preserves bytes after SIGKILL and also works with all other libraries removed', { timeout: 90000, skip: process.platform === 'win32' }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wanxiangli-trace-package-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const packed = JSON.parse(succeed(spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: root, env, encoding: 'utf8', timeout: 30000 })))[0]
  assert.ok(packed.files.some(file => file.path === 'dist/trace/Trace.js'))
  for (const file of packed.files) assert.doesNotMatch(file.path, /\.fs(?:proj|i)?$|^scripts\/|^node_modules\//)
  const consumer = path.join(directory, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'trace-consumer', private: true, type: 'module' }))
  succeed(spawnSync('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(directory, packed.filename)], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  for (const file of ['trace-consumer.mjs', 'trace-consumer.ts']) copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  const installed = path.join(consumer, 'node_modules/wanxiangli')
  assert.deepEqual(JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8')).dependencies ?? {}, {})
  assert.equal(existsSync(path.join(consumer, 'node_modules/@fable-org')), false)
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { encoding: 'utf8', env }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its trace consumer is not verified.')
  const script = path.join(consumer, 'trace-consumer.mjs')
  for (const [runtime, executable] of runtimes) {
    await t.test(`real trace and SQLite restart on ${runtime}`, async subtest => {
      const database = path.join(directory, `${runtime}.sqlite`)
      const child = spawn(executable, [script, runtime, 'start', database], { cwd: tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'] })
      let diagnostics = ''
      child.stderr.on('data', bytes => { diagnostics += bytes })
      subtest.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit')
          child.kill('SIGKILL')
          await exited
        }
      })
      const lines = createInterface({ input: child.stdout })
      subtest.after(() => lines.close())
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(`No commit barrier\n${diagnostics}`)), 10000)
        lines.once('line', text => {
          clearTimeout(timer)
          try { resolve(JSON.parse(text)) } catch (error) { reject(error) }
        })
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('exit', (code, signal) => { clearTimeout(timer); reject(Error(`Trace consumer exited ${code}/${signal}\n${diagnostics}`)) })
      })
      assert.equal(ready.phase, 'committed')
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
      const reply = succeed(spawnSync(executable, [script, runtime, 'recover', database, JSON.stringify(ready.checkpoint)], { cwd: tmpdir(), env, encoding: 'utf8', timeout: 10000 }))
      assert.equal(JSON.parse(reply.trim()).recovered, true)
    })
  }
  for (const name of ['lifecycle', 'eventstore', 'assembly', 'process']) {
    rmSync(path.join(installed, 'dist', name), { recursive: true, force: true })
    rmSync(path.join(installed, 'src', name), { recursive: true, force: true })
  }
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'trace-consumer.ts'], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  for (const [runtime, executable] of runtimes) {
    await t.test(`trace alone on ${runtime}`, () => {
      const reply = succeed(spawnSync(executable, [script, runtime, 'isolated'], { cwd: tmpdir(), env, encoding: 'utf8', timeout: 10000 }))
      assert.equal(JSON.parse(reply.trim()).isolated, true)
    })
  }
})
