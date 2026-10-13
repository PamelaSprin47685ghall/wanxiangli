import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { ProcessSession } from 'wanxiangli/process'

export const workerFile = fileURLToPath(new URL('./worker.mjs', import.meta.url))

export function options(mode, args = [], overrides = {}) {
  return {
    executable: process.execPath,
    args: [workerFile, mode, ...args],
    cwd: tmpdir(),
    env: {},
    tailBytes: 65536,
    maxWriteBytes: 1048576,
    ...overrides,
  }
}

export function session(t, mode, args = [], overrides = {}) {
  const run = new ProcessSession(options(mode, args, overrides))
  t.after(async () => {
    await run.started()
    run.signal('SIGKILL')
    const end = await run.wait(5000)
    assert.equal(end.kind, 'Closed', JSON.stringify(end))
  })
  return run
}

export async function ready(run) {
  const start = await run.started()
  assert.equal(start.kind, 'Started', JSON.stringify(start))
  return start.pid
}

export async function closed(run) {
  const end = await run.wait(5000)
  assert.equal(end.kind, 'Closed', JSON.stringify(end))
  return end.state
}

export async function until(observe, label = 'observation', timeout = 5000) {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    const result = observe()
    if (result) return result
    await delay(5)
  }
  assert.fail(`No ${label} before the test deadline`)
}

export function output(run, channel = 'stdout') { return run.read(channel, 0) }

export function temporary(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'wanxiangli-process-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}
