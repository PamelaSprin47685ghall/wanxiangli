import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { digest, runtimeKey } from './build-inputs.mjs'

export function locations(root) {
  const state = path.join(root, '.build-service')
  const name = digest(root).slice(0, 32)
  const socketDirectory = process.platform === 'win32' ? null : path.join('/tmp', `wanxiangli-build-${process.getuid()}`)
  return { state, active: path.join(state, 'active'), retired: path.join(state, 'retired'),
    socketDirectory, socket: socketDirectory ? path.join(socketDirectory, name + '.sock') : `\\\\.\\pipe\\wanxiangli-build-${name}` }
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

function processStarted(pid) {
  if (process.platform === 'win32') return null
  const result = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='],
    { env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' }, encoding: 'utf8' })
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim()
  if (!alive(pid)) return null
  throw new Error(`Cannot identify build service process ${pid}`)
}

function ownerAlive(previous) {
  return alive(previous.pid) && (!previous.started || processStarted(previous.pid) === previous.started)
}

export function owner(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(locations(root).active, 'owner.json')))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export function release(root, previous) {
  const places = locations(root)
  try {
    // 保留非空的旧代目录；迟到的接管者不能把新 active 改名覆盖它。
    fs.renameSync(places.active, path.join(places.retired, previous.token))
  } catch (error) {
    if (!['ENOENT', 'EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error
  }
}

export function claim(root) {
  const places = locations(root)
  fs.mkdirSync(places.retired, { recursive: true })
  const identity = { root, pid: process.pid, started: processStarted(process.pid), token: randomUUID() }
  const candidate = path.join(places.state, 'candidate-' + identity.token)
  fs.mkdirSync(candidate)
  fs.writeFileSync(path.join(candidate, 'owner.json'), JSON.stringify(identity))
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        fs.renameSync(candidate, places.active)
        return identity
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error
      }
      const previous = owner(root)
      if (previous && ownerAlive(previous)) return null
      if (previous) release(root, previous)
    }
    return null
  } finally { fs.rmSync(candidate, { recursive: true, force: true }) }
}

function exchange(socketPath, request, output) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    let connected = false
    let complete = false
    let buffer = ''
    const finish = (error, result) => {
      if (complete) return
      complete = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(result)
    }
    const timer = setTimeout(() => finish(new Error('Build request timed out; inspect --status before retrying')), 180000)
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      connected = true
      socket.write(JSON.stringify(request) + '\n')
    })
    socket.on('data', chunk => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        try {
          const message = JSON.parse(line)
          if (message.type === 'log') output(message)
          else if (message.type === 'result') finish(null, message.result)
          else finish(new Error('Unknown build service response'))
        } catch (error) { finish(error) }
      }
    })
    socket.on('error', error => {
      error.unavailable = !connected && ['ECONNREFUSED', 'ENOENT'].includes(error.code)
      finish(error)
    })
    socket.on('close', () => finish(new Error('Build service disconnected before reporting a result; run the build again')))
  })
}

export async function request(root, command, output = () => {}) {
  const places = locations(root)
  const runtime = runtimeKey(root)
  const deadline = Date.now() + 30000
  let started = 0
  let startupError
  while (Date.now() < deadline) {
    if (startupError) throw startupError
    try {
      const result = await exchange(places.socket, { ...command, root, runtime, protocol: 1 }, output)
      if (!result.retry) return result
    } catch (error) {
      if (!error.unavailable) throw error
      const current = owner(root)
      const running = current && ownerAlive(current)
      if (!running && command.op !== 'build') return { ok: true, running: false }
      if (!running && Date.now() - started > 250) {
        fs.mkdirSync(places.state, { recursive: true })
        const log = fs.openSync(path.join(places.state, 'service.log'), 'a')
        const { NODE_OPTIONS, NODE_PATH, ESBUILD_BINARY_PATH, ...env } = process.env
        try {
          const child = spawn(process.execPath, [path.join(root, 'scripts/build-service.mjs'), root, runtime],
            { cwd: root, env, detached: true, stdio: ['ignore', log, log] })
          child.on('error', error => { startupError = error })
          child.on('exit', code => {
            if (code) startupError = new Error(`Build service failed to start; see ${path.join(places.state, 'service.log')}`)
          })
          child.unref()
        } finally { fs.closeSync(log) }
        started = Date.now()
      }
    }
    await delay(30)
  }
  throw new Error(`Build service did not become ready; see ${path.join(places.state, 'service.log')}`)
}
