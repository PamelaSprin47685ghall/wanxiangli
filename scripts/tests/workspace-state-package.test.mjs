import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
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

test('workspace-state 实际安装包在 Node/Bun 查询工作树并初始化宿主状态目录', { timeout: 90000 }, t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wanxiangli-workspace-state-package-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: root, env, encoding: 'utf8', timeout: 30000 })))
  assert.ok(packed.files.some(file => file.path === 'dist/workspace-state/WorkspaceState.js'))
  assert.ok(packed.files.some(file => file.path === 'src/workspace-state/index.d.ts'))
  for (const file of packed.files) assert.doesNotMatch(file.path, /\.fs(?:proj|i)?$|^scripts\/|^node_modules\//)
  const consumer = path.join(directory, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'workspace-state-consumer', private: true, type: 'module' }))
  succeed(spawnSync('npm', ['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(directory, packed.filename)], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  for (const file of ['workspace-state-consumer.mjs', 'workspace-state-consumer.ts']) copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  assert.equal(existsSync(path.join(consumer, 'node_modules/@fable-org')), false)
  assert.match(readFileSync(path.join(consumer, 'node_modules/wanxiangli/dist/workspace-state/WorkspaceState.js'), 'utf8'), /from ["']wanxiangli\/git-porcelain["']/)
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'workspace-state-consumer.ts'], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { encoding: 'utf8', env }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its workspace-state consumer was not run.')
  for (const [runtime, executable] of runtimes) {
    const output = succeed(spawnSync(executable, [path.join(consumer, 'workspace-state-consumer.mjs')], { cwd: consumer, env, encoding: 'utf8', timeout: 30000 }))
    assert.equal(output.trim(), 'workspace-state consumer passed', runtime)
  }
})
