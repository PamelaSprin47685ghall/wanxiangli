import fs from 'node:fs'
import path from 'node:path'
import { fork } from 'node:child_process'
import { locations, owner } from './build-state.mjs'

export function createBuildProcess(root, identity, slot, output) {
  const record = path.join(locations(root).active, slot === 0 ? 'worker.json' : `worker-${slot}.json`)
  let worker
  let key
  let retiring
  let pending
  let sequence = 0
  let generation = 0
  let completed = 0
  const removeRecord = () => {
    if (owner(root)?.token === identity.token) fs.rmSync(record, { force: true })
  }
  async function close() {
    if (retiring) return retiring
    const previous = worker
    worker = undefined
    key = undefined
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
      removeRecord()
    }
  }
  async function start(nextKey) {
    if (worker && key !== nextKey) await close()
    if (worker) return
    generation++
    key = nextKey
    worker = fork(path.join(root, 'scripts/build-worker.mjs'), [root],
      { cwd: root, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    const current = worker
    fs.writeFileSync(record, JSON.stringify({ pid: current.pid, generation }))
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
      completed = message.completed ?? completed
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
        key = undefined
        completed = 0
        removeRecord()
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
  return { start, call, close,
    get pid() { return worker?.pid ?? null },
    get key() { return key },
    get generation() { return generation },
    get completed() { return completed } }
}
