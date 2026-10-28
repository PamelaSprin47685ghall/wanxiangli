import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const repository = fileURLToPath(new URL('../..', import.meta.url))
export function testDirectory(prefix) {
  const parent = path.join(repository, '.build-tests')
  fs.mkdirSync(parent, { recursive: true })
  return fs.realpathSync(fs.mkdtempSync(path.join(parent, prefix)))
}
export function installBuild(directory) {
  fs.mkdirSync(path.join(directory, 'scripts'), { recursive: true })
  for (const name of fs.readdirSync(path.join(repository, 'scripts')).filter(name => name.endsWith('.mjs'))) {
    fs.copyFileSync(path.join(repository, 'scripts', name), path.join(directory, 'scripts', name))
  }
  if (fs.existsSync(path.join(repository, 'package-lock.json'))) {
    fs.copyFileSync(path.join(repository, 'package-lock.json'), path.join(directory, 'package-lock.json'))
  }
}
export function cleanEnvironment(extra = {}) {
  const { NODE_OPTIONS, NODE_PATH, WANXIANGLI_BUILD_FORCE, WANXIANGLI_BUILD_IDLE_MS,
    WANXIANGLI_CHECKER_PROJECT_LIMIT, ESBUILD_BINARY_PATH, ...env } = process.env
  return { ...env, PATH: path.dirname(process.execPath) + path.delimiter + env.PATH, ...extra }
}
export function stopBuild(directory) {
  if (!fs.existsSync(path.join(directory, 'scripts/build.mjs'))) return
  const lease = path.join(directory, '.build-service/active/owner.json')
  const previous = fs.existsSync(lease) ? JSON.parse(fs.readFileSync(lease)) : null
  const result = spawnSync(process.execPath, [path.join(directory, 'scripts/build.mjs'), '--stop'],
    { env: cleanEnvironment(), encoding: 'utf8', timeout: 30000 })
  if (result.error || result.status !== 0) throw new Error(`Cannot stop fixture service: ${result.error ?? result.stderr}`)
  if (previous) {
    const until = Date.now() + 3000
    while (Date.now() < until) {
      try { process.kill(previous.pid, 0) }
      catch (error) {
        if (error.code === 'ESRCH') return
        throw error
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
    throw new Error('Fixture service did not exit')
  }
}
