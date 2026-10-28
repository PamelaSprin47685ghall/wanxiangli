import fs from 'node:fs'
import path from 'node:path'
import { fork } from 'node:child_process'
import { cached, discover, files, moduleInput, toolchainKey } from './build-inputs.mjs'
import { alive, locations, owner } from './build-state.mjs'

export function createSession(root, identity, projectLimit, output) {
  const places = locations(root)
  const stamps = path.join(root, '.build-stamps')
  const scratch = path.join(root, '.build')
  let worker
  let workerKey
  let retiring
  let pending
  let sequence = 0
  let generation = 0
  let completed = 0
  const dropStamp = name => fs.rmSync(path.join(stamps, name + '.json'), { force: true })
  const checkOwner = () => {
    if (owner(root)?.token !== identity.token) throw new Error('Build service lost workspace ownership')
  }
  function cleanAbandoned() {
    fs.mkdirSync(scratch, { recursive: true })
    for (const name of fs.readdirSync(scratch)) {
      const match = /-(\d+)$/.exec(name)
      if (match && !alive(Number(match[1]))) fs.rmSync(path.join(scratch, name), { recursive: true, force: true })
    }
  }
  async function retire() {
    if (retiring) return retiring
    const previous = worker
    worker = undefined
    workerKey = undefined
    completed = 0
    if (!previous) return
    retiring = new Promise(resolve => {
      if (previous.exitCode !== null || previous.signalCode !== null) {
        resolve()
        return
      }
      const timer = setTimeout(() => previous.kill('SIGKILL'), 2000)
      previous.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      previous.kill('SIGTERM')
    })
    try { await retiring }
    finally {
      retiring = undefined
      if (owner(root)?.token === identity.token) fs.rmSync(path.join(places.active, 'worker.json'), { force: true })
    }
  }
  async function launch(key) {
    if (worker && workerKey !== key) await retire()
    if (worker) return
    generation++
    workerKey = key
    worker = fork(path.join(root, 'scripts/build-worker.mjs'), [root],
      { cwd: root, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    const current = worker
    fs.writeFileSync(path.join(places.active, 'worker.json'), JSON.stringify({ pid: current.pid, generation }))
    for (const stream of ['stdout', 'stderr']) {
      current[stream].setEncoding('utf8')
      current[stream].on('data', text => output({ stream, text }))
    }
    current.on('message', message => {
      if (message.type === 'log') {
        output(message)
        return
      }
      if (pending?.worker !== current || pending.id !== message.id) return
      const waiting = pending
      pending = undefined
      clearTimeout(waiting.timer)
      waiting.resolve(message)
    })
    const failed = error => {
      if (pending?.worker !== current) return
      const waiting = pending
      pending = undefined
      clearTimeout(waiting.timer)
      waiting.reject(error)
    }
    current.on('error', failed)
    current.on('exit', (code, signal) => {
      if (worker === current) {
        worker = undefined
        workerKey = undefined
        completed = 0
        if (owner(root)?.token === identity.token) fs.rmSync(path.join(places.active, 'worker.json'), { force: true })
      }
      failed(new Error(`Compiler worker exited: ${code ?? signal}`))
    })
  }
  function call(command) {
    return new Promise((resolve, reject) => {
      const id = ++sequence
      const current = worker
      const timer = setTimeout(() => {
        pending = undefined
        current.kill('SIGKILL')
        reject(new Error('Compiler worker timed out'))
      }, 120000)
      pending = { id, worker: current, resolve, reject, timer }
      current.send({ ...command, id }, error => {
        if (error && pending?.id === id) {
          pending = undefined
          clearTimeout(timer)
          reject(error)
        }
      })
    })
  }
  function verifyModule(input, key) {
    try {
      if (moduleInput(input.name, input.project, key).key === input.key) return
    } catch {}
    dropStamp(input.name)
    throw new Error(`Inputs changed during build: ${input.name}; run the build again`)
  }
  function verify(inputs, projects, allModules, key) {
    checkOwner()
    if (toolchainKey(root) !== key) {
      for (const input of inputs) dropStamp(input.name)
      throw new Error('Inputs changed during build: toolchain; run the build again')
    }
    for (const input of inputs) verifyModule(input, key)
    const current = discover(root)
    if ((allModules && current.size !== projects.size)
      || inputs.some(input => current.get(input.name) !== input.project)) {
      throw new Error('Inputs changed during build: module projects; run the build again')
    }
  }
  async function build(command) {
    const started = performance.now()
    checkOwner()
    cleanAbandoned()
    const key = toolchainKey(root)
    if (worker && key !== workerKey) await retire()
    const projects = discover(root)
    const allModules = !command.selected.length
    const names = allModules ? [...projects.keys()] : [...new Set(command.selected)]
    if (!names.length) throw new Error('No implemented modules found')
    const inputs = names.map(name => {
      if (!projects.has(name)) throw new Error(`Unknown module: ${name}`)
      return moduleInput(name, projects.get(name), key)
    })
    const dirty = []
    const skipped = []
    let result = { rows: [], fcsMs: 0 }
    try {
      for (const input of inputs) {
        if (!command.force && cached(root, input)) {
          skipped.push(input.name)
          console.log(`[build] ${input.name}: cached`)
        } else dirty.push({ ...input, temporary: path.join(scratch, `${input.name}-${identity.pid}`) })
      }
      if (dirty.length) {
        await launch(key)
        result = await call({ op: 'build', inputs: dirty })
        if (!result.ok) throw Object.assign(new Error(result.error), { diagnostics: result.diagnostics })
        completed = result.completed
      }
      if (dirty.length) verify(inputs, projects, allModules, key)
      fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
      fs.mkdirSync(stamps, { recursive: true })
      for (const input of dirty) {
        const target = path.join(root, 'dist', input.name)
        const backup = path.join(input.temporary, 'previous')
        checkOwner()
        verifyModule(input, key)
        dropStamp(input.name)
        if (fs.existsSync(target)) fs.renameSync(target, backup)
        try {
          fs.renameSync(path.join(input.temporary, 'package'), target)
          const stamp = path.join(stamps, input.name + '.json')
          fs.writeFileSync(stamp + '.new', JSON.stringify({ key: input.key, outputs: files(target) }))
          fs.renameSync(stamp + '.new', stamp)
        } catch (error) {
          fs.rmSync(target, { recursive: true, force: true })
          if (fs.existsSync(backup)) fs.renameSync(backup, target)
          throw error
        }
        console.log(`[build] ${input.name}: ${Math.round(result.rows.find(row => row.name === input.name).ms)} ms`)
      }
      verify(inputs, projects, allModules, key)
      const removed = []
      if (allModules) {
        const candidates = new Set(fs.readdirSync(stamps).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)))
        for (const entry of fs.readdirSync(path.join(root, 'dist'), { withFileTypes: true })) {
          if (entry.isDirectory()) candidates.add(entry.name)
        }
        for (const name of candidates) {
          if (!projects.has(name)) {
            fs.rmSync(path.join(root, 'dist', name), { recursive: true, force: true })
            dropStamp(name)
            removed.push(name)
          }
        }
      }
      const compiledBy = dirty.length ? result.pid : null
      const retired = completed >= projectLimit
      if (retired) await retire()
      return { ok: true, built: dirty.map(input => input.name), cached: skipped, removed,
        ms: performance.now() - started, fcsMs: result.fcsMs, rows: result.rows,
        compiledBy, workerPid: worker?.pid ?? null, generation, retired,
        checkers: result.checkers ?? null, completed }
    } catch (error) {
      for (const input of dirty) dropStamp(input.name)
      await retire()
      throw error
    } finally {
      for (const input of dirty) fs.rmSync(input.temporary, { recursive: true, force: true })
      cleanAbandoned()
    }
  }
  return { build, close: retire,
    async status() { return { generation, completed, workerPid: worker?.pid ?? null,
      compiler: worker ? await call({ op: 'stats' }) : null } } }
}
