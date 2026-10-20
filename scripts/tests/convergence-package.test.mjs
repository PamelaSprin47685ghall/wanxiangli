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

test('SPEC[convergence-package] installed convergence and retention merge a real fork in a clean consumer on every available runtime', { timeout: 90000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wanxiangli-convergence-package-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: root, env, encoding: 'utf8', timeout: 30000 })))
  assert.ok(packed.files.some(file => file.path === 'dist/convergence/KWayMerge.js'))
  assert.ok(packed.files.some(file => file.path === 'src/convergence/index.d.ts'))
  assert.ok(packed.files.some(file => file.path === 'dist/retention/WriterRetention.js'))
  for (const file of packed.files) assert.doesNotMatch(file.path, /\.fs(?:proj|i)?$|^scripts\/|^node_modules\//)
  const consumer = path.join(directory, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'convergence-consumer', private: true, type: 'module' }))
  succeed(spawnSync('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(directory, packed.filename)], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  for (const file of ['convergence-consumer.mjs', 'convergence-consumer.ts']) copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  assert.equal(existsSync(path.join(consumer, 'node_modules/@fable-org')), false)
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'convergence-consumer.ts'], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { encoding: 'utf8', env }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its convergence consumer is not verified.')
  for (const [runtime, executable] of runtimes) {
    const output = succeed(spawnSync(executable, [path.join(consumer, 'convergence-consumer.mjs')], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
    assert.deepEqual(JSON.parse(output), { kept: ['today'], fork: ['a', 'b', 'c'], duplicate: 'NonCanonical', retained: 1 }, runtime)
  }
})
