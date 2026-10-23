import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

// 已实现模块 = src/ 下带唯一 fsproj 的目录；入口 = 最后一个 Compile 文件（与 scripts/build.mjs 同一规则）。
function implementedModules() {
  const modules = new Map()
  for (const directory of readdirSync(path.join(root, 'src'), { withFileTypes: true })) {
    if (!directory.isDirectory()) continue
    const folder = path.join(root, 'src', directory.name)
    const project = readdirSync(folder).find(file => file.endsWith('.fsproj'))
    if (!project) continue
    const xml = readFileSync(path.join(folder, project), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    const includes = [...xml.matchAll(/<Compile\s+[^>]*Include\s*=\s*("[^"]*|'[^']*)/g)]
      .map(match => match[1].slice(1).trim().replaceAll('\\', '/'))
    modules.set(directory.name, `./dist/${directory.name}/${path.basename(includes.at(-1), '.fs')}.js`)
  }
  return modules
}

test('SPEC[build-008] every implemented module has exactly one public entry built from its own project', () => {
  const modules = implementedModules()
  const entries = Object.entries(manifest.exports)
  for (const [name, expected] of modules) {
    const matches = entries.filter(([, target]) => target.import === expected)
    assert.equal(matches.length, 1, `${name} must be exported once as ${expected}`)
    assert.equal(matches[0][1].types, `./src/${name}/index.d.ts`, `${name} types must sit beside its source`)
  }
  for (const [subpath, target] of entries) {
    const owner = target.import.split('/')[2]
    assert.ok(modules.has(owner), `${subpath} points at ${target.import}, which no implemented module builds`)
  }
})

test('SPEC[build-008] every exported type declaration exists and is shipped by the files whitelist', () => {
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const types = target.types.replace(/^\.\//, '')
    assert.ok(existsSync(path.join(root, types)), `${subpath}: ${types} is missing`)
    assert.ok(manifest.files.includes(types), `${subpath}: ${types} is not in files`)
  }
  assert.ok(manifest.files.includes('dist/'), 'built entries are shipped through dist/')
})

test('SPEC[build-008] a module subpath appears once and the files whitelist has no stale declaration', () => {
  const declared = manifest.files.filter(file => file.endsWith('/index.d.ts'))
  const exported = Object.values(manifest.exports).map(target => target.types.replace(/^\.\//, ''))
  assert.deepEqual([...declared].sort(), [...exported].sort())
  assert.equal(new Set(exported).size, exported.length)
})
