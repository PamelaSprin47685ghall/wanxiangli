import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { request } from './build-state.mjs'

const root = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const supplied = process.argv.slice(2)
const json = supplied.includes('--json')
try {
  const args = []
  let jobs = 1
  let parallel = false
  for (let index = 0; index < supplied.length; index++) {
    const arg = supplied[index]
    if (arg === '--parallel' || arg === '--jobs' || arg.startsWith('--jobs=')) {
      if (parallel) throw new Error('Specify --parallel or --jobs only once')
      parallel = true
      const value = arg === '--parallel' ? '2' : arg === '--jobs' ? supplied[++index] : arg.slice(7)
      if (!/^[1-4]$/.test(value ?? '')) throw new Error('--jobs must be an integer from 1 to 4')
      jobs = Number(value)
    } else args.push(arg)
  }
  const supported = new Set(['--force', '--json', '--status', '--stop', '--help'])
  for (const arg of args) {
    if (arg.startsWith('--') && !supported.has(arg)) throw new Error(`Unknown build option: ${arg}`)
  }
  if (args.includes('--help')) {
    console.log('Usage: npm run build -- [modules] [--parallel | --jobs N] [--force] [--json]\n--parallel: 2 compiler processes; --jobs: 1–4 (default 1). Extra processes exit after each build.\n--status queries the service; --stop stops it. Controls cannot be combined with build options.')
    process.exit(0)
  }
  const selected = args.filter(arg => !supported.has(arg))
  const op = args.includes('--stop') ? 'stop' : args.includes('--status') ? 'status' : 'build'
  if ((args.includes('--stop') && args.includes('--status'))
    || (op !== 'build' && (selected.length || args.includes('--force') || parallel))) throw new Error('Status and stop cannot be combined with a build')
  const result = await request(root, { op, selected, jobs,
    force: args.includes('--force') || /^(1|true|yes)$/i.test(process.env.WANXIANGLI_BUILD_FORCE ?? '') }, message => {
    if (!json) process[message.stream].write(message.text)
  })
  if (json || op !== 'build') console.log(JSON.stringify(result))
  if (!result.ok) {
    if (!json) console.error(result.error)
    process.exitCode = 1
  }
} catch (error) {
  if (json) console.log(JSON.stringify({ ok: false, error: error.message }))
  else console.error(error.message)
  process.exitCode = 1
}
