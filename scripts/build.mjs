import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { request } from './build-state.mjs'

const root = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)
const json = args.includes('--json')
try {
  const supported = new Set(['--force', '--json', '--status', '--stop'])
  for (const arg of args) {
    if (arg.startsWith('--') && !supported.has(arg)) throw new Error(`Unknown build option: ${arg}`)
  }
  const selected = args.filter(arg => !supported.has(arg))
  const op = args.includes('--stop') ? 'stop' : args.includes('--status') ? 'status' : 'build'
  if ((args.includes('--stop') && args.includes('--status'))
    || (op !== 'build' && (selected.length || args.includes('--force')))) throw new Error('Status and stop cannot be combined with a build')
  const result = await request(root, { op, selected,
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
