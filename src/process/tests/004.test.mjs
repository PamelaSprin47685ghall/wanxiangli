import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ProcessSession } from 'wanxiangli/process'
import { options, session, ready, closed, until, output } from './support.mjs'

test('SPEC[process-004] wait timeout leaves the same process alive and accepts later input', async t => {
  const run = session(t, 'echo')
  const pid = await ready(run)
  const first = await run.wait(10)
  assert.equal(first.kind, 'TimedOut')
  assert.equal(first.state.phase, 'Running')
  assert.equal(first.state.exit, null)
  assert.equal(run.inspect().pid, pid)
  await run.write(Buffer.from('still the same process'))
  run.endInput()
  assert.equal((await closed(run)).exit.code, 0)
  assert.equal(output(run).text, 'still the same process')
})

test('SPEC[process-004] signal acknowledgement does not mean a TERM-ignoring process exited', async t => {
  const run = session(t, 'idle')
  await ready(run)
  await until(() => output(run).text === 'ready\n')
  assert.equal(run.signal('SIGTERM').kind, 'Requested')
  assert.equal(run.inspect().exit, null)
  await until(() => output(run, 'stderr').text === 'term-seen\n')
  assert.equal((await run.wait(10)).kind, 'TimedOut')
  assert.equal(run.signal('SIGKILL').kind, 'Requested')
  assert.equal((await closed(run)).exit.signal, 'SIGKILL')
  assert.equal(run.signal('SIGTERM').kind, 'NotRunning')
})

test('SPEC[process-004] waiting callers are independent and their timers are cleaned', async t => {
  const run = session(t, 'echo')
  await ready(run)
  const before = process.getActiveResourcesInfo().filter(kind => kind === 'Timeout').length
  const long = run.wait(60000)
  const expired = await Promise.all(Array.from({ length: 150 }, () => run.wait(2)))
  assert.ok(expired.every(result => result.kind === 'TimedOut'))
  run.endInput()
  assert.equal((await long).kind, 'Closed')
  await new Promise(setImmediate)
  const after = process.getActiveResourcesInfo().filter(kind => kind === 'Timeout').length
  assert.ok(after <= before, `Timeout handles grew: ${before} -> ${after}`)
})

test('SPEC[process-004] invalid wait durations and signals do not change the process', async t => {
  const run = session(t, 'idle')
  await ready(run)
  for (const budget of [0, -1, 0.5, NaN, Infinity, 2147483648, '1', null]) {
    assert.throws(() => run.wait(budget))
  }
  assert.throws(() => run.signal('not-a-signal'), /Unsupported/)
  assert.equal(run.inspect().phase, 'Running')
  run.endInput()
  await closed(run)
})

function notLive(pid) {
  try {
    if (process.platform === 'linux') {
      const state = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1)[0]
      return state === 'Z' || state === 'X'
    }
    process.kill(pid, 0)
    return false
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return true
    throw error
  }
}

test('SPEC[process-004] signals reach the owned POSIX group, including the real grandchild', async t => {
  const run = session(t, 'group')
  await ready(run)
  await until(() => output(run).text?.includes('\n'))
  const pid = JSON.parse(output(run).text.split('\n')[0]).grandchild
  t.after(() => { try { process.kill(pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } })
  run.signal('SIGTERM')
  await until(() => output(run).text.includes('grandchild-term\n'))
  await until(() => output(run, 'stderr').text.includes('leader-term\n'))
  assert.equal((await run.wait(10)).kind, 'TimedOut')
  run.signal('SIGKILL')
  assert.equal((await closed(run)).exit.signal, 'SIGKILL')
  await until(() => notLive(pid), 'grandchild termination')
})

test('SPEC[process-004] direct exit does not complete wait while inherited output is open', async t => {
  const run = new ProcessSession(options('draining'))
  let pid
  t.after(async () => {
    if (pid) { try { process.kill(pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }
    run.signal('SIGKILL')
    await closed(run)
  })
  await ready(run)
  await until(() => output(run).text?.includes('\n'))
  pid = JSON.parse(output(run).text.split('\n')[0]).grandchild
  await until(() => run.inspect().phase === 'Draining')
  assert.deepEqual(run.inspect().exit, { code: 0, signal: null })
  assert.equal((await run.wait(10)).kind, 'TimedOut')
  assert.equal(run.signal('SIGKILL').kind, 'NotRunning')
  process.kill(pid, 'SIGKILL')
  await closed(run)
})
