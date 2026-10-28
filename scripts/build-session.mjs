import fs from 'node:fs'
import path from 'node:path'
import { cached, discover, files, moduleInput, toolchainKey } from './build-inputs.mjs'
import { alive, locations, owner } from './build-state.mjs'
import { createUsage } from './build-usage.mjs'
import { createBuildProcess } from './build-process.mjs'

export function createSession(root, identity, projectLimit, output) {
  const places = locations(root)
  const stamps = path.join(root, '.build-stamps')
  const scratch = path.join(root, '.build')
  const usage = createUsage(path.join(places.state, 'usage.json'))
  const primary = createBuildProcess(root, identity, 0, output)
  let extras = []
  const close = () => Promise.all([primary, ...extras].map(worker => worker.close()))
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
    if (primary.pid && key !== primary.key) await close()
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
    let workers = []
    const reports = []
    let tasks = []
    let finishUsage
    let outcome = 'failure'
    try {
      for (const input of inputs) {
        if (!command.force && cached(root, input)) {
          skipped.push(input.name)
          console.log(`[build] ${input.name}: cached`)
        } else dirty.push({ ...input, temporary: path.join(scratch, `${input.name}-${identity.pid}`) })
      }
      if (dirty.length) {
        const count = Math.min(command.jobs ?? 1, dirty.length)
        console.log(`[build] compiling ${dirty.length} modules with ${count} compiler process(es)`)
        extras = Array.from({ length: count - 1 }, (_, index) => createBuildProcess(root, identity, index + 1, output))
        workers = [primary, ...extras]
        for (const worker of workers) await worker.start(key)
        finishUsage = usage.begin({ workerPid: primary.pid, workerPids: workers.map(worker => worker.pid),
          jobs: count, projects: dirty.length, toolchain: key })
        tasks = workers.map(async (worker, index) => {
          const reply = await worker.call({ op: 'build', inputs: dirty.filter((_, position) => position % count === index) })
          reports[index] = reply
          if (!reply.ok) throw Object.assign(new Error(reply.error), { diagnostics: reply.diagnostics })
          return reply
        })
        await Promise.all(tasks)
        result = {
          rows: reports.flatMap(reply => reply.rows),
          fcsMs: reports.reduce((sum, reply) => sum + reply.fcsMs, 0),
          checkers: reports.reduce((sum, reply) => sum + reply.checkers, 0),
        }
        await Promise.all(extras.map(worker => worker.close()))
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
      const compiledBy = reports[0]?.pid ?? null
      const retired = primary.completed >= projectLimit
      if (retired) await primary.close()
      outcome = 'success'
      return { ok: true, built: dirty.map(input => input.name), cached: skipped, removed,
        ms: performance.now() - started, fcsMs: result.fcsMs, rows: result.rows,
        compiledBy, compiledByPids: reports.map(reply => reply.pid), jobs: workers.length,
        workerPid: primary.pid, generation: primary.generation, retired,
        checkers: result.checkers ?? null, completed: primary.completed }
    } catch (error) {
      for (const input of dirty) dropStamp(input.name)
      await close()
      await Promise.allSettled(tasks)
      throw error
    } finally {
      for (const input of dirty) fs.rmSync(input.temporary, { recursive: true, force: true })
      cleanAbandoned()
      const received = reports.filter(Boolean)
      const reuse = received.length === workers.length && received.every(reply => reply.reuse)
        ? Object.fromEntries(['created', 'reused', 'reusedAcrossBuilds'].map(name =>
          [name, received.reduce((sum, reply) => sum + reply.reuse[name], 0)])) : null
      const memory = received.length === workers.length && received.every(reply => reply.memory)
        ? Object.fromEntries(Object.keys(received[0]?.memory ?? {}).map(name =>
          [name, received.reduce((sum, reply) => sum + reply.memory[name], 0)])) : null
      finishUsage?.({ outcome, reuse, workerMemory: memory,
        workers: received.map(reply => ({ pid: reply.pid, reuse: reply.reuse, memory: reply.memory,
          completed: reply.completed, retired: reply.pid !== primary.pid })),
        serviceMemory: process.memoryUsage(), retired: !primary.pid })
      extras = []
    }
  }
  return { build, close,
    async status() { return { generation: primary.generation, completed: primary.completed, workerPid: primary.pid,
      compiler: primary.pid ? await primary.call({ op: 'stats' }) : null } } }
}
