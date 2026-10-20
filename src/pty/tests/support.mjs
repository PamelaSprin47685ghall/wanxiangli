import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const bun = spawnSync('bun', ['--version'], { encoding: 'utf8' })
export const bunMissing = bun.status === 0 ? false : 'bun is not installed; bun-pty only runs under Bun'

/** Runs one real-PTY scenario under Bun and returns its JSON result. */
export function scenario(name) {
  const run = spawnSync('bun', [path.join(here, 'scenario.mjs'), name], {
    cwd: here, encoding: 'utf8', timeout: 30000,
  })
  if (run.status !== 0) throw new Error(`scenario ${name} failed (${run.status}): ${run.stderr}`)
  return JSON.parse(run.stdout.trim().split('\n').at(-1))
}
