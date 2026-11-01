import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packedPackage } from './package-metadata.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const { NODE_PATH, NODE_OPTIONS, npm_config_allow_scripts, ...env } = process.env
const succeed = result => {
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result.stdout
}

test('实际安装包在 Node/Bun 保留基线、计算差异并独立认领案例结算', { timeout: 90000 }, t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wanxiangli-file-baseline-package-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: root, env, encoding: 'utf8', timeout: 30000 })))
  assert.ok(packed.files.some(file => file.path === 'dist/file-baseline/FileBaseline.js'))
  assert.ok(packed.files.some(file => file.path === 'src/file-baseline/index.d.ts'))
  assert.ok(packed.files.some(file => file.path === 'dist/casebook/CasebookIndexLaw.js'))
  assert.equal(packed.files.some(file => /^(dist|src)\/casebook-maintenance\//.test(file.path)), false)
  for (const file of packed.files) assert.doesNotMatch(file.path, /\.fs(?:proj|i)?$|^scripts\/|^node_modules\//)
  const consumer = path.join(directory, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'file-baseline-consumer', private: true, type: 'module' }))
  succeed(spawnSync('npm', ['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(directory, packed.filename)], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  for (const file of ['file-baseline-consumer.mjs', 'file-baseline-consumer.ts']) copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  assert.equal(existsSync(path.join(consumer, 'node_modules/@fable-org')), false)
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'file-baseline-consumer.ts'], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { encoding: 'utf8', env }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its file-baseline consumer was not run.')
  for (const [runtime, executable] of runtimes) {
    const output = succeed(spawnSync(executable, [path.join(consumer, 'file-baseline-consumer.mjs')], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
    assert.equal(output.trim(), 'file-baseline consumer passed', runtime)
  }
})
