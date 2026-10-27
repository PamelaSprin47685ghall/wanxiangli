import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { testDirectory, installBuild, stopBuild, cleanEnvironment, repository } from './build-fixture.mjs'

export const data = value => `namespace ResidentProbe\nmodule Data =\n    let value = ${value}\n`
export const project = '<Project><ItemGroup><Compile Include="Data.fs" /><Compile Include="Probe.fs" /></ItemGroup></Project>'
const source = 'namespace ResidentProbe\n[<Fable.Core.AttachMembers>]\ntype Probe() =\n    member _.value = Data.value\n    member _.count = List.length [1; 2; 3]\n'

export function fixture(t, { privateDependencies = false, pause = false } = {}) {
  const directory = testDirectory('resident-')
  t.after(() => {
    stopBuild(directory)
    fs.rmSync(directory, { recursive: true, force: true })
  })
  installBuild(directory)
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ type: 'module', scripts: { build: 'node scripts/build.mjs' } }))
  if (privateDependencies) fs.cpSync(path.join(repository, 'node_modules'), path.join(directory, 'node_modules'), { recursive: true })
  else fs.symlinkSync(path.join(repository, 'node_modules'), path.join(directory, 'node_modules'), 'junction')
  for (const name of ['alpha', 'beta']) {
    const folder = path.join(directory, 'src', name)
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'Probe.fsproj'), project)
    fs.writeFileSync(path.join(folder, 'Data.fs'), data(1))
    fs.writeFileSync(path.join(folder, 'Probe.fs'), source)
  }
  if (pause) {
    const file = path.join(directory, 'scripts/compiler.mjs')
    const original = fs.readFileSync(file, 'utf8')
    const anchor = 'async compile(project, outDir) {'
    assert.ok(original.includes(anchor))
    fs.writeFileSync(file, "import fs from 'node:fs'\nimport { setTimeout as pause } from 'node:timers/promises'\n" + original.replace(anchor, anchor + `
      const pauseName = fs.existsSync('pause-compiler') ? fs.readFileSync('pause-compiler', 'utf8') : null
      if (pauseName !== null && (!pauseName || path.basename(path.dirname(project)) === pauseName)) {
        fs.writeFileSync('compiler-paused', String(process.pid))
        while (fs.existsSync('pause-compiler')) await pause(10)
      }
`))
  }
  return directory
}

export function start(directory, args = [], { npm = false, env = {} } = {}) {
  const started = performance.now()
  const child = spawn(npm ? 'npm' : process.execPath,
    npm ? ['--silent', 'run', 'build', '--', ...args, '--json'] : ['scripts/build.mjs', ...args, '--json'],
    { cwd: directory, env: cleanEnvironment(env), stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', value => { stdout += value })
  child.stderr.on('data', value => { stderr += value })
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (status, signal) => {
      try {
        const lines = stdout.trim().split('\n')
        resolve({ ...JSON.parse(lines.at(-1)), status, signal, stdout, stderr,
          clientPid: child.pid, wallMs: performance.now() - started })
      } catch (error) { reject(new Error(`${error.message}\n${stdout}\n${stderr}`)) }
    })
  })
  return { child, finished }
}
export const run = (directory, args, options) => start(directory, args, options).finished
export function good(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.ok, true, result.stdout)
  return result
}
export function change(directory, name, value) {
  fs.writeFileSync(path.join(directory, 'src', name, 'Data.fs'), data(value))
}
export function values(directory, name = 'alpha') {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { Probe } from './dist/${name}/Probe.js'; const p=new Probe(); console.log(JSON.stringify([p.value,p.count]));`],
  { cwd: directory, env: cleanEnvironment(), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
export function artifacts(directory) {
  const dist = path.join(directory, 'dist')
  return Object.fromEntries(fs.readdirSync(dist, { recursive: true }).filter(name => fs.statSync(path.join(dist, name)).isFile())
    .map(name => [name, fs.readFileSync(path.join(dist, name), 'utf8')]))
}
export function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
export async function waitFor(predicate, milliseconds = 10000) {
  const until = Date.now() + milliseconds
  while (Date.now() < until) {
    const value = predicate()
    if (value) return value
    await delay(20)
  }
  throw new Error('Condition did not become true')
}

export function processTree(pid) {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const rows = result.stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number))
  const found = [pid]
  for (let index = 0; index < found.length; index++) {
    found.push(...rows.filter(row => row[1] === found[index] && !found.includes(row[0])).map(row => row[0]))
  }
  return found
}
