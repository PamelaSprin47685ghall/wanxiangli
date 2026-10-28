import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { testDirectory, installBuild, stopBuild } from './build-fixture.mjs'
const root = fileURLToPath(new URL('../..', import.meta.url))
const data = value => `namespace CacheProbe\nmodule Data =\n    let value = ${value}\n`
const probe = 'namespace CacheProbe\n[<Fable.Core.AttachMembers>]\ntype Probe() =\n    member _.value: int = Data.value\n'
const project = (include = '<Compile Include="Data.fs" />') => `<Project><ItemGroup>${include}<Compile Include="Probe.fs" /></ItemGroup></Project>`

function installSaveHook(directory) {
  writeFileSync(path.join(directory, 'scripts/save-hook.mjs'), `
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, appendFileSync } from 'node:fs'
const log = console.log
console.log = (...args) => {
  if (existsSync('mutation.json') && !existsSync('mutation-ran')) {
    const { mutation, boundary } = JSON.parse(readFileSync('mutation.json', 'utf8'))
    const message = String(args[0])
    if (boundary === 'compiler'
      ? message.startsWith('Project:') && message.includes('FCS time:')
      : message.startsWith('[build] alpha:')) {
      writeFileSync('mutation-ran', 'yes')
      new Function('writeFileSync', 'rmSync', 'mkdirSync', 'appendFileSync', mutation)(writeFileSync, rmSync, mkdirSync, appendFileSync)
    }
  }
  log(...args)
}
`)
  for (const name of ['build-session.mjs', 'compiler.mjs']) {
    const file = path.join(directory, 'scripts', name)
    writeFileSync(file, "import './save-hook.mjs'\n" + readFileSync(file, 'utf8'))
  }
}

function fixture(t, include) {
  const directory = testDirectory('inputs-')
  t.after(() => {
    stopBuild(directory)
    rmSync(directory, { recursive: true, force: true })
  })
  installBuild(directory)
  installSaveHook(directory)
  writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}')
  symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction')
  for (const name of ['alpha', 'beta']) {
    const folder = path.join(directory, 'src', name)
    mkdirSync(folder, { recursive: true })
    writeFileSync(path.join(folder, 'Probe.fsproj'), project(name === 'alpha' ? include : undefined))
    writeFileSync(path.join(folder, 'Data.fs'), data(1))
    writeFileSync(path.join(folder, 'Probe.fs'), probe)
  }
  return directory
}

function run(directory, args) {
  const { NODE_PATH, NODE_OPTIONS, WANXIANGLI_BUILD_FORCE, ...env } = process.env
  const result = spawnSync(process.execPath, args, { cwd: directory, env, encoding: 'utf8', timeout: 60000 })
  assert.ifError(result.error)
  return result
}

function build(directory, ...args) {
  const result = run(directory, ['scripts/build.mjs', ...args])
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result.stdout
}

function value(directory, name) {
  const result = run(directory, ['--input-type=module', '-e', `import { Probe } from './dist/${name}/Probe.js'; console.log(new Probe().value)`])
  assert.equal(result.status, 0, result.stderr)
  return Number(result.stdout.trim())
}

function artifact(directory, name) {
  return readFileSync(path.join(directory, 'dist', name, 'Probe.js'), 'utf8')
}

function mutateDuringBuild(directory, mutation, boundary = 'log', ...args) {
  writeFileSync(path.join(directory, 'mutation.json'), JSON.stringify({ mutation, boundary }))
  try {
    const result = run(directory, ['scripts/build.mjs', ...args])
    assert.equal(existsSync(path.join(directory, 'mutation-ran')), true)
    return result
  } finally { rmSync(path.join(directory, 'mutation.json'), { force: true }) }
}

function rejected(directory, result) {
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stderr, /inputs changed during build/i)
  assert.equal(existsSync(path.join(directory, '.build-stamps/alpha.json')), false)
  assert.deepEqual(readdirSync(path.join(directory, '.build')), [])
}

for (const [name, include] of [
  ['attribute order', '<Compile Link="Data.fs" Include="Data.fs" />'],
  ['single quotes', "<Compile Include='Data.fs' />"],
  ['spacing and line breaks', '<Compile\n Link="Data.fs" Include =\n "Data.fs" />'],
  ['comments', '<!-- <ProjectReference Include="missing.fsproj" /><Compile Include="Missing.fs" /> --><Compile Include="Data.fs" />'],
]) {
  test(`WHAT[build-010] ${name} keeps every compiled source in the incremental fingerprint`, { timeout: 60000 }, t => {
    const directory = fixture(t, include)
    const source = path.join(directory, 'src/alpha/Data.fs')
    const time = new Date(1600000000000)
    utimesSync(source, time, time)
    build(directory)
    assert.equal(value(directory, 'alpha'), 1)
    const beta = artifact(directory, 'beta')
    writeFileSync(source, data(2))
    utimesSync(source, time, time)
    const output = build(directory)
    assert.match(output, /\[build\] alpha: \d+ ms/)
    assert.match(output, /\[build\] beta: cached/)
    assert.equal(value(directory, 'alpha'), 2)
    const incremental = artifact(directory, 'alpha')
    assert.match(build(directory), /\[build\] alpha: cached/)
    build(directory, 'alpha', '--force')
    assert.equal(artifact(directory, 'alpha'), incremental)
    assert.equal(artifact(directory, 'beta'), beta)
  })
}

test('WHAT[build-010] the public entry uses the last active Compile element with flexible attributes', { timeout: 60000 }, t => {
  const directory = fixture(t)
  writeFileSync(path.join(directory, 'src/alpha/Probe.fsproj'), '<Project><ItemGroup><Compile Include="Data.fs" /><Compile Link="Probe.fs" Include = \'Probe.fs\' /><!-- <Compile Include="Missing.fs" /> --></ItemGroup></Project>')
  build(directory)
  assert.equal(value(directory, 'alpha'), 1)
})

test('WHAT[build-010] an all-cached build rejects a source saved after its cache check', { timeout: 60000 }, t => {
  const directory = fixture(t)
  build(directory)
  rejected(directory, mutateDuringBuild(directory, `writeFileSync('src/alpha/Data.fs', ${JSON.stringify(data(2))})`))
  assert.equal(value(directory, 'alpha'), 1)
  assert.equal(existsSync(path.join(directory, '.build-stamps/beta.json')), true)
  const output = build(directory)
  assert.match(output, /\[build\] alpha: \d+ ms/)
  assert.match(output, /\[build\] beta: cached/)
  assert.equal(value(directory, 'alpha'), 2)
})

test('WHAT[build-010] a source saved during compilation cannot replace the previous artifact', { timeout: 60000 }, t => {
  const directory = fixture(t)
  build(directory)
  const before = artifact(directory, 'alpha')
  writeFileSync(path.join(directory, 'src/alpha/Data.fs'), data(2))
  rejected(directory, mutateDuringBuild(directory, `writeFileSync('src/alpha/Data.fs', ${JSON.stringify(data(3))})`, 'compiler'))
  assert.equal(artifact(directory, 'alpha'), before)
  assert.match(build(directory), /\[build\] beta: cached/)
  assert.equal(value(directory, 'alpha'), 3)
})

test('WHAT[build-010] a source saved after publication invalidates that module before success', { timeout: 60000 }, t => {
  const directory = fixture(t)
  build(directory)
  writeFileSync(path.join(directory, 'src/alpha/Data.fs'), data(2))
  rejected(directory, mutateDuringBuild(directory, `writeFileSync('src/alpha/Data.fs', ${JSON.stringify(data(3))})`))
  assert.match(build(directory), /\[build\] beta: cached/)
  assert.equal(value(directory, 'alpha'), 3)
})

test('WHAT[build-010] a project changed after a cache hit cannot retain its stamp', { timeout: 60000 }, t => {
  const directory = fixture(t)
  build(directory)
  rejected(directory, mutateDuringBuild(directory, "appendFileSync('src/alpha/Probe.fsproj', '\\n<!-- saved during build -->\\n')"))
  assert.match(build(directory), /\[build\] alpha: \d+ ms/)
})

test('WHAT[build-010] deleting a cached source rejects the build and permits a clean retry', { timeout: 60000 }, t => {
  const directory = fixture(t)
  build(directory)
  rejected(directory, mutateDuringBuild(directory, "rmSync('src/alpha/Data.fs')"))
  writeFileSync(path.join(directory, 'src/alpha/Data.fs'), data(2))
  assert.match(build(directory), /\[build\] beta: cached/)
  assert.equal(value(directory, 'alpha'), 2)
})

test('WHAT[build-010] adding a module during an all-module build is detected', { timeout: 60000 }, t => {
  const directory = fixture(t)
  build(directory)
  const result = mutateDuringBuild(directory, `
mkdirSync('src/gamma')
writeFileSync('src/gamma/Probe.fsproj', ${JSON.stringify(project())})
writeFileSync('src/gamma/Data.fs', ${JSON.stringify(data(2))})
writeFileSync('src/gamma/Probe.fs', ${JSON.stringify(probe)})
`)
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /inputs changed during build/i)
  const output = build(directory)
  assert.match(output, /\[build\] alpha: cached/)
  assert.match(output, /\[build\] beta: cached/)
  assert.equal(value(directory, 'gamma'), 2)
})

test('WHAT[build-010] a selected build does not reject changes to an unselected module', { timeout: 60000 }, t => {
  const directory = fixture(t)
  build(directory)
  const result = mutateDuringBuild(directory, `writeFileSync('src/beta/Data.fs', ${JSON.stringify(data(2))})`, 'log', 'alpha')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(value(directory, 'beta'), 1)
  assert.match(build(directory), /\[build\] alpha: cached/)
  assert.equal(value(directory, 'beta'), 2)
})

for (const file of ['build.mjs', 'compiler.mjs']) {
  test(`WHAT[build-010] changing ${file} invalidates every selected stamp`, { timeout: 60000 }, t => {
    const directory = fixture(t)
    build(directory)
    rejected(directory, mutateDuringBuild(directory, `appendFileSync('scripts/${file}', '\\n// saved during build\\n')`))
    assert.equal(existsSync(path.join(directory, '.build-stamps/beta.json')), false)
    assert.doesNotMatch(build(directory), /: cached/)
  })
}
