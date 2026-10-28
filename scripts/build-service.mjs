import fs from 'node:fs'
import net from 'node:net'
import { format } from 'node:util'
import { claim, locations, owner, release } from './build-state.mjs'
import { runtimeKey, settings } from './build-inputs.mjs'

const root = fs.realpathSync(process.argv[2])
const expected = process.argv[3]
if (runtimeKey(root) !== expected) process.exit(0)
const identity = claim(root)
if (!identity) process.exit(0)
const places = locations(root)
const configuration = settings()
const sockets = new Set()
let active
let queue = Promise.resolve()
let queued = 0
let closing = false
let shutdown
let idle
let session
const send = (socket, result) => {
  if (!socket.destroyed) socket.end(JSON.stringify({ type: 'result', result }) + '\n')
}
const output = message => {
  if (active && !active.destroyed) active.write(JSON.stringify({ type: 'log', ...message }) + '\n')
}
console.log = (...args) => output({ stream: 'stdout', text: format(...args) + '\n' })
const server = net.createServer(socket => {
  sockets.add(socket)
  socket.on('error', () => {})
  socket.on('close', () => sockets.delete(socket))
  socket.setEncoding('utf8')
  let buffer = ''
  let received = false
  socket.on('data', chunk => {
    if (received) return
    buffer += chunk
    if (buffer.length > 65536) {
      socket.destroy()
      return
    }
    const end = buffer.indexOf('\n')
    if (end < 0) return
    received = true
    let command
    try {
      command = JSON.parse(buffer.slice(0, end))
      if (command.protocol !== 1 || command.root !== root || !['build', 'status', 'stop'].includes(command.op)
        || (command.op === 'build' && (!Array.isArray(command.selected)
          || (command.jobs !== undefined && (!Number.isInteger(command.jobs) || command.jobs < 1 || command.jobs > 4))
          || command.selected.some(name => typeof name !== 'string') || typeof command.force !== 'boolean'))) {
        throw new Error('Invalid build request')
      }
    } catch (error) {
      send(socket, { ok: false, error: error.message })
      return
    }
    if (command.op !== 'status') {
      clearTimeout(idle)
      queued++
    }
    queue = queue.then(async () => {
      active = socket
      try {
        if (closing) {
          send(socket, { retry: true })
          return
        }
        if (command.op === 'build' && (command.runtime !== expected || runtimeKey(root) !== expected)) {
          send(socket, { retry: true })
          stop()
          return
        }
        if (socket.destroyed) return
        if (command.op === 'stop') {
          closing = true
          await session.close()
          send(socket, { ok: true, stopped: true, servicePid: process.pid })
          stop()
        } else {
          const result = command.op === 'status'
            ? { ok: true, running: true, compatible: command.runtime === expected, ...await session.status(), ...configuration }
            : await session.build(command)
          send(socket, { ...result, servicePid: process.pid, token: identity.token, root })
        }
      } catch (error) {
        await session.close()
        send(socket, { ok: false, error: error.message, diagnostics: error.diagnostics ?? [], servicePid: process.pid })
      } finally {
        active = undefined
        if (command.op !== 'status') {
          queued--
          if (!closing && queued === 0) armIdle()
        }
      }
    })
  })
})

function armIdle() {
  clearTimeout(idle)
  idle = setTimeout(stop, configuration.idleMs)
}

function stop() {
  if (shutdown) return shutdown
  closing = true
  clearTimeout(idle)
  shutdown = (async () => {
    const closed = new Promise(resolve => server.close(resolve))
    await session.close()
    await queue
    for (const socket of sockets) send(socket, { retry: true })
    await closed
    if (owner(root)?.token === identity.token) release(root, identity)
  })().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  return shutdown
}

try {
  const { createSession } = await import('./build-session.mjs')
  if (runtimeKey(root) !== expected) {
    release(root, identity)
    process.exit(0)
  }
  session = createSession(root, identity, configuration.projectLimit, output)
  if (places.socketDirectory) {
    fs.mkdirSync(places.socketDirectory, { recursive: true, mode: 0o700 })
    if (fs.statSync(places.socketDirectory).uid !== process.getuid()) throw new Error('Build socket directory has another owner')
    fs.rmSync(places.socket, { force: true })
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(places.socket, resolve)
  })
  if (places.socketDirectory) fs.chmodSync(places.socket, 0o600)
  server.on('error', error => {
    console.error(error)
    stop()
  })
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  armIdle()
} catch (error) {
  console.error(error)
  await session?.close()
  server.close()
  if (owner(root)?.token === identity.token) release(root, identity)
  process.exitCode = 1
}
