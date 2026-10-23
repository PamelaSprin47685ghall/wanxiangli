import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, copyFileSync, symlinkSync, utimesSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createCompiler } from '../compiler.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const library = path.join(root, 'node_modules/@fable-org/fable-library-js')
const cli = path.join(root, 'node_modules/@fable-org/fable-compiler-js/index.js')

function fixture(t) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'wanxiangli-checker-')))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}')
  return directory
}

function source(directory, name, text) {
  mkdirSync(path.dirname(path.join(directory, name)), { recursive: true })
  writeFileSync(path.join(directory, name), text)
}

function project(directory, files, properties = '') {
  source(directory, 'Probe.fsproj', `<Project><PropertyGroup>${properties}</PropertyGroup><ItemGroup>${files.map(file => `<Compile Include="${file}" />`).join('')}</ItemGroup></Project>`)
  return path.join(directory, 'Probe.fsproj')
}

function run(directory, args) {
  const { NODE_OPTIONS, NODE_PATH, WANXIANGLI_BUILD_FORCE, ...env } = process.env
  const result = spawnSync(process.execPath, args, { cwd: directory, env, encoding: 'utf8', timeout: 60000 })
  assert.ifError(result.error)
  return result
}

function outputs(directory) {
  return Object.fromEntries(readdirSync(directory, { recursive: true }).filter(file => file.endsWith('.js'))
    .map(file => [file, readFileSync(path.join(directory, file), 'utf8')]))
}

async function observedCompiler() {
  await import('@fable-org/fable-standalone')
  const init = globalThis.__FABLE_STANDALONE__.init
  const stats = { created: 0, cleared: 0, parsed: 0 }
  globalThis.__FABLE_STANDALONE__.init = () => {
    const manager = init()
    return {
      ...manager,
      CreateChecker(...args) {
        stats.created++
        return manager.CreateChecker(...args)
      },
      ClearCache(checker) {
        stats.cleared++
        manager.ClearCache(checker)
      },
      ParseAndCheckProject(...args) {
        stats.parsed++
        assert.equal(stats.cleared, stats.parsed, 'clear the previous project before each parse')
        return manager.ParseAndCheckProject(...args)
      },
    }
  }
  try {
    return { compiler: await createCompiler(library), stats }
  } finally {
    globalThis.__FABLE_STANDALONE__.init = init
  }
}

async function compare(compiler, projectFile, expected) {
  const directory = path.dirname(projectFile)
  const out = path.join(directory, 'output')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out)
  const fresh = run(directory, [cli, projectFile, out, '--fableLib', library])
  const freshFiles = outputs(out)
  // 此版 CLI 在部分编译错误下仍退出 0，必须同时检查诊断和输出。
  const freshFailed = fresh.status !== 0 || /ERROR:|Error:/.test(fresh.stdout + fresh.stderr)
  assert.equal(freshFailed, expected === undefined, fresh.stdout + fresh.stderr)
  rmSync(out, { recursive: true })
  mkdirSync(out)
  const init = globalThis.__FABLE_STANDALONE__.init
  if (expected === undefined) {
    await assert.rejects(compiler.compile(projectFile, out))
    assert.deepEqual(outputs(out), freshFiles)
  } else {
    await compiler.compile(projectFile, out)
    assert.deepEqual(outputs(out), freshFiles)
    const result = run(directory, ['--input-type=module', '-e', `import { read } from ${JSON.stringify(pathToFileURL(path.join(out, 'Probe.js')).href)}; console.log(JSON.stringify(read()))`])
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout.trim()), expected)
  }
  assert.equal(globalThis.__FABLE_STANDALONE__.init, init)
}

test('WHAT[build-011] one checker isolates source edits, removed files, signatures and same-named projects', { timeout: 120000 }, async t => {
  const directory = fixture(t)
  const { compiler, stats } = await observedCompiler()
  const dependency = value => `module ProbeData\nlet value = ${value}\nlet inline add x = x + value\n`
  const consumer = expression => `module Probe\nlet read () = ${expression}\n`
  source(directory, 'Data.fs', dependency(10))
  source(directory, 'Probe.fs', consumer('ProbeData.add 2'))
  const file = project(directory, ['Data.fs', 'Probe.fs'])
  const time = new Date(1600000000000)
  utimesSync(path.join(directory, 'Data.fs'), time, time)
  await compare(compiler, file, 12)
  source(directory, 'Data.fs', dependency(20))
  utimesSync(path.join(directory, 'Data.fs'), time, time)
  await compare(compiler, file, 22)

  project(directory, ['Probe.fs'])
  await compare(compiler, file, undefined)
  project(directory, ['Probe.fs', 'Data.fs'])
  await compare(compiler, file, undefined)
  source(directory, 'Data.fsi', 'module ProbeData\nval value: int\n')
  project(directory, ['Data.fsi', 'Data.fs', 'Probe.fs'])
  await compare(compiler, file, undefined)
  source(directory, 'Probe.fs', consumer('ProbeData.value'))
  await compare(compiler, file, 20)
  source(directory, 'Data.fsi', 'module ProbeData\nval value: string\n')
  await compare(compiler, file, undefined)
  source(directory, 'Data.fs', 'module ProbeData\nlet value = "changed"\n')
  source(directory, 'Probe.fs', consumer('ProbeData.value.Length'))
  await compare(compiler, file, 7)

  const other = path.join(directory, '路径 with spaces')
  source(other, '内部/Data.fs', dependency(30))
  source(other, 'Probe.fs', consumer('ProbeData.add 2'))
  await compare(compiler, project(other, ['内部/Data.fs', 'Probe.fs']), 32)
  await compare(compiler, file, 7)
  assert.deepEqual(stats, { created: 1, cleared: 10, parsed: 10 })
})

test('WHAT[build-011] compiler options do not leak between projects or after an error', { timeout: 90000 }, async t => {
  const directory = fixture(t)
  const { compiler, stats } = await observedCompiler()
  source(directory, 'Probe.fs', 'module Probe\n#if ALTERNATE\nlet read () = 1\n#else\nlet read () = 2\n#endif\n')
  const file = project(directory, ['Probe.fs'])
  await compare(compiler, file, 2)
  project(directory, ['Probe.fs'], '<DefineConstants>ALTERNATE</DefineConstants>')
  await compare(compiler, file, 1)
  const other = path.join(directory, 'other')
  source(other, 'Probe.fs', readFileSync(path.join(directory, 'Probe.fs'), 'utf8'))
  await compare(compiler, project(other, ['Probe.fs']), 2)
  project(directory, ['Probe.fs'])
  await compare(compiler, file, 2)
  assert.equal(stats.created, 2)

  source(directory, 'Probe.fs', 'module Probe\nlet partial x = match x with | 0 -> 3\nlet read () = partial 0\n')
  await compare(compiler, file, 3)
  project(directory, ['Probe.fs'], '<WarningsAsErrors>25</WarningsAsErrors>')
  await compare(compiler, file, undefined)
  project(directory, ['Probe.fs'])
  await compare(compiler, file, 3)
  assert.deepEqual(stats, { created: 3, cleared: 7, parsed: 7 })
})

test('WHAT[build-011] references with the same name but different bytes use different checkers', { timeout: 60000 }, async t => {
  const directory = fixture(t)
  const { compiler, stats } = await observedCompiler()
  const metadata = await import('@fable-org/fable-metadata')
  const assembly = path.join(directory, 'System.Text.RegularExpressions.dll')
  copyFileSync(path.join(metadata.getAssembliesDir(), path.basename(assembly)), assembly)
  const file = path.join(directory, 'Probe.fsx')
  source(directory, 'Probe.fsx', '#r "System.Text.RegularExpressions.dll"\nlet read () = System.Text.RegularExpressions.Regex.IsMatch("abc", "^a")\n')
  const cwd = process.cwd()
  try {
    // Fable 的 fsx 解析器按当前目录读取脚本；本测试用 #r 验证真实 DLL 内容。
    process.chdir(directory)
    await compare(compiler, file, true)
    await compare(compiler, file, true)
    // PE 文件末尾附加字节不改变类型，仍应使引用内容的隔离键变化。
    writeFileSync(assembly, Buffer.concat([readFileSync(assembly), Buffer.from([0])]))
    await compare(compiler, file, true)
  } finally {
    process.chdir(cwd)
  }
  assert.deepEqual(stats, { created: 2, cleared: 3, parsed: 3 })
})

test('WHAT[build-011] output failures reject the awaited compile and allow a clean retry', { timeout: 60000 }, async t => {
  const directory = fixture(t)
  const { compiler } = await observedCompiler()
  source(directory, 'Probe.fs', 'module Probe\nlet read () = 42\n')
  const file = project(directory, ['Probe.fs'])
  const out = path.join(directory, 'blocked')
  writeFileSync(out, 'keep this file')
  await assert.rejects(compiler.compile(file, out), /EEXIST|ENOTDIR/)
  assert.equal(readFileSync(out, 'utf8'), 'keep this file')
  await compare(compiler, file, 42)
})

test('WHAT[build-011] each build exits, unchanged modules skip FCS, and compiler changes invalidate stamps', { timeout: 60000 }, t => {
  const directory = fixture(t)
  mkdirSync(path.join(directory, 'scripts'))
  for (const file of ['build.mjs', 'compiler.mjs']) {
    copyFileSync(path.join(root, 'scripts', file), path.join(directory, 'scripts', file))
  }
  symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction')
  for (const name of ['alpha', 'beta']) {
    const folder = path.join(directory, 'src', name)
    source(folder, 'Probe.fs', 'namespace BuildProbe\n[<Fable.Core.AttachMembers>]\ntype Probe() =\n    member _.value = 1\n')
    project(folder, ['Probe.fs'])
  }
  const build = () => {
    const result = run(directory, ['scripts/build.mjs'])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return result.stdout
  }
  assert.equal((build().match(/FCS time:/g) ?? []).length, 2)
  const initial = outputs(path.join(directory, 'dist'))
  const cached = build()
  assert.equal((cached.match(/: cached/g) ?? []).length, 2)
  assert.doesNotMatch(cached, /fable|FCS time:|Checker/)
  source(directory, 'scripts/compiler.mjs', `${readFileSync(path.join(directory, 'scripts/compiler.mjs'), 'utf8')}\n// changed compiler entry\n`)
  assert.equal((build().match(/FCS time:/g) ?? []).length, 2)
  assert.deepEqual(outputs(path.join(directory, 'dist')), initial)

  source(directory, 'src/alpha/Probe.fs', 'namespace BuildProbe\n[<Fable.Core.AttachMembers>]\ntype Probe() =\n    member _.value = typeof<int>.GetMethods().Length\n')
  const failed = run(directory, ['scripts/build.mjs'])
  assert.notEqual(failed.status, 0, failed.stdout + failed.stderr)
  assert.match(failed.stdout, /not supported by Fable/)
  assert.deepEqual(outputs(path.join(directory, 'dist')), initial)
  assert.deepEqual(readdirSync(path.join(directory, '.build')), [])
  source(directory, 'src/alpha/Probe.fs', 'namespace BuildProbe\n[<Fable.Core.AttachMembers>]\ntype Probe() =\n    member _.value = 2\n')
  const recovered = build()
  assert.equal((recovered.match(/FCS time:/g) ?? []).length, 1)
  assert.match(recovered, /\[build\] beta: cached/)
  const value = run(directory, ['--input-type=module', '-e', 'import { Probe } from "./dist/alpha/Probe.js"; console.log(new Probe().value)'])
  assert.equal(value.status, 0, value.stderr)
  assert.equal(value.stdout.trim(), '2')
})
