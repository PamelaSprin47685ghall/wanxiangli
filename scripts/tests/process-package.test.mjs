import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packedPackage } from './package-metadata.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const { NODE_PATH, NODE_OPTIONS, ...env } = process.env
const succeed = result => {
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result.stdout
}

test('the installed runtime runs portable commands and Linux process groups without unrelated artifacts', { timeout: 90000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wanxiangli-process-package-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: root, env, encoding: 'utf8', timeout: 30000 })))
  assert.ok(packed.files.some(file => file.path === 'dist/runtime/Runtime.js'))
  assert.ok(packed.files.some(file => file.path === 'src/runtime/index.d.ts'))
  const consumer = path.join(directory, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'process-only-consumer', private: true, type: 'module' }))
  succeed(spawnSync('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(directory, packed.filename)], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  const installed = path.join(consumer, 'node_modules/wanxiangli')
  for (const module of ['lifecycle', 'eventstore', 'assembly']) {
    rmSync(path.join(installed, 'dist', module), { recursive: true, force: true })
    rmSync(path.join(installed, 'src', module), { recursive: true, force: true })
  }
  assert.equal(existsSync(path.join(consumer, 'node_modules/@fable-org')), false)
  assert.equal(existsSync(path.join(installed, 'src/runtime/process/ProcessSession.fs')), false)
  for (const name of ['process-consumer.mjs', 'process-consumer.ts']) copyFileSync(path.join(root, 'scripts/tests', name), path.join(consumer, name))
  copyFileSync(path.join(root, 'src/runtime/process/tests/worker.mjs'), path.join(consumer, 'process-worker.mjs'))
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'process-consumer.ts'], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { encoding: 'utf8', env }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its process consumer is not verified in this environment.')
  for (const [name, executable] of runtimes) {
    await t.test(`portable process consumer on ${name}`, () => {
      const output = succeed(spawnSync(executable, [path.join(consumer, 'process-consumer.mjs'), name, 'portable'], { cwd: tmpdir(), env, encoding: 'utf8', timeout: 15000 }))
      assert.deepEqual(JSON.parse(output.trim()), { runtime: name, echo: true, boundedOutput: true, runProcess: true })
    })
    await t.test(`Linux process group consumer on ${name}`, { skip: process.platform !== 'linux' }, () => {
      const output = succeed(spawnSync(executable, [path.join(consumer, 'process-consumer.mjs'), name, 'group'], { cwd: tmpdir(), env, encoding: 'utf8', timeout: 15000 }))
      assert.deepEqual(JSON.parse(output.trim()), { runtime: name, groupSignal: true })
    })
  }
})
