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
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const { NODE_PATH, NODE_OPTIONS, ...cleanEnvironment } = process.env

function succeed(result) {
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result.stdout
}

test('SPEC[build-002] an installed tarball survives a real effect and process death without dispatching twice', { timeout: 90000, skip: process.platform === 'win32' }, async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'wanxiangli-package-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const packed = JSON.parse(succeed(spawnSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 })))[0]
  assert.ok(packed.files.some(file => file.path === 'dist/lifecycle/Work.js'))
  assert.ok(packed.files.some(file => file.path === 'dist/eventstore/SqliteJournal.js'))
  for (const file of packed.files) assert.doesNotMatch(file.path, /\.fs(?:proj|i)?$|^scripts\/|^node_modules\//)
  const consumer = path.join(temporary, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'independent-consumer', private: true, type: 'module' }))
  succeed(spawnSync(npm, ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const installed = JSON.parse(readFileSync(path.join(consumer, 'node_modules/wanxiangli/package.json'), 'utf8'))
  assert.deepEqual(installed.dependencies ?? {}, {})
  assert.deepEqual(installed.peerDependencies ?? {}, {})
  assert.equal(existsSync(path.join(consumer, 'node_modules/esbuild')), false)
  assert.equal(existsSync(path.join(consumer, 'node_modules/wanxiangli/scripts')), false)
  for (const file of ['consumer.mjs', 'consumer.ts']) copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'consumer.ts'], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const script = path.join(consumer, 'consumer.mjs')
  const runtimes = [ ['node', process.execPath] ]
  const bun = spawnSync('bun', ['--version'], { env: cleanEnvironment, encoding: 'utf8' })
  if (bun.status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; only the Node package consumer can be proven in this environment.')
  for (const [runtime, executable] of runtimes) {
    await t.test(`installed consumer on ${runtime}`, async subtest => {
      const database = path.join(temporary, `${runtime}.sqlite`)
      const effects = path.join(temporary, `${runtime}-effects.jsonl`)
      const child = spawn(executable, [script, runtime, 'start', database, effects], { cwd: tmpdir(), env: cleanEnvironment, stdio: ['ignore', 'pipe', 'pipe'] })
      let diagnostics = ''
      child.stderr.on('data', data => { diagnostics += data })
      subtest.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit')
          child.kill('SIGKILL')
          await exited
        }
      })
      const lines = createInterface({ input: child.stdout })
      subtest.after(() => lines.close())
      const reached = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No effect barrier reached\n${diagnostics}`)), 10000)
        lines.once('line', value => {
          clearTimeout(timer)
          try { resolve(JSON.parse(value)) } catch (error) { reject(error) }
        })
        child.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`Consumer exited ${code}/${signal}\n${diagnostics}`)) })
        child.once('error', error => { clearTimeout(timer); reject(error) })
      })
      assert.equal(reached.phase, 'effect-completed')
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
      const recovery = succeed(spawnSync(executable, [script, runtime, 'recover', database, effects], { cwd: tmpdir(), env: cleanEnvironment, encoding: 'utf8', timeout: 10000 }))
      assert.equal(JSON.parse(recovery.trim()).externalEffects, 1)
      assert.equal(readFileSync(effects, 'utf8').trim().split('\n').length, 1)
    })
  }
})
