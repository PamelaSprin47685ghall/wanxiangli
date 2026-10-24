import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { ProcessSession } from 'wanxiangli/runtime'

const [runtime] = process.argv.slice(2)
const runs = []
const options = mode => ({
  executable: process.execPath,
  args: [fileURLToPath(new URL('./process-worker.mjs', import.meta.url)), mode],
  cwd: process.cwd(), env: {}, tailBytes: 1024, maxWriteBytes: 1048576,
})
const make = (mode, extra = {}) => {
  const run = new ProcessSession({ ...options(mode), ...extra })
  runs.push(run)
  return run
}
const until = async observe => {
  const end = performance.now() + 5000
  while (performance.now() < end) {
    if (observe()) return
    await delay(5)
  }
  throw new Error('Process observation barrier was not reached')
}
const closed = async run => {
  const result = await run.wait(5000)
  assert.equal(result.kind, 'Closed', JSON.stringify(result))
  return result.state
}

assert.equal((await import('wanxiangli/runtime')).ProcessSession, ProcessSession)
let grandchild
try {
  const echo = make('echo', { tailBytes: 8 })
  assert.equal((await echo.started()).kind, 'Started')
  const beforeClose = echo.wait(60000)
  assert.equal((await echo.wait(5)).kind, 'TimedOut')
  assert.equal((await echo.write(Buffer.from('hello🧭 end'))).kind, 'Written')
  echo.endInput()
  assert.equal((await beforeClose).kind, 'Closed')
  assert.equal(echo.read('stdout', 0).text, '🧭 end')
  assert.equal(echo.read('stdout', 0).discarded, 5)
  assert.equal(echo.inspect().exit.code, 0)

  const flood = make('flood')
  const floodState = await closed(flood)
  assert.ok(floodState.stdout.observed > 8 * 1024 * 1024)
  assert.equal(floodState.stdout.retained, 1024)
  assert.ok(flood.read('stdout', 0).text.endsWith('最后的原始输出🧭\n'))

  const group = make('group')
  assert.equal((await group.started()).kind, 'Started')
  await until(() => group.read('stdout', 0).text?.includes('\n'))
  grandchild = JSON.parse(group.read('stdout', 0).text.split('\n')[0]).grandchild
  assert.equal(group.signal('SIGTERM').kind, 'Requested')
  await until(() => group.read('stdout', 0).text.includes('grandchild-term\n'))
  await until(() => group.read('stderr', 0).text.includes('leader-term\n'))
  assert.equal((await group.wait(10)).kind, 'TimedOut')
  assert.equal(group.signal('SIGKILL').kind, 'Requested')
  assert.equal((await closed(group)).exit.signal, 'SIGKILL')
  await until(() => {
    try {
      const state = readFileSync(`/proc/${grandchild}/stat`, 'utf8').split(') ').at(-1)[0]
      return state === 'Z' || state === 'X'
    } catch (error) { if (error.code === 'ENOENT') return true; throw error }
  })
  assert.equal(group.signal('SIGKILL').kind, 'NotRunning')
  console.log(JSON.stringify({ runtime, echo: true, boundedOutput: true, groupSignal: true }))
} finally {
  for (const run of runs) {
    await run.started()
    run.signal('SIGKILL')
    await closed(run)
  }
  if (grandchild) {
    try { process.kill(grandchild, 'SIGKILL') }
    catch (error) { if (error.code !== 'ESRCH') throw error }
  }
}
