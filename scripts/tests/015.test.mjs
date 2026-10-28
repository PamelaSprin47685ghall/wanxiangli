import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fixture, start, run, good, change, values, artifacts, alive, waitFor, processTree } from './resident-fixture.mjs'

for (const victim of ['worker', 'service']) {
  test(`WHAT[build-015] killing the ${victim} also releases an already-running bundler`, { timeout: 60000 }, async t => {
    const directory = fixture(t, { pause: true })
    const first = good(await run(directory))
    const before = artifacts(directory)
    fs.writeFileSync(path.join(directory, 'pause-compiler'), 'beta')
    const interrupted = start(directory, ['--force'])
    await waitFor(() => fs.existsSync(path.join(directory, 'compiler-paused')))
    const processes = processTree(first.servicePid)
    assert.ok(processes.length >= 3, `Expected service, compiler and bundler: ${processes}`)
    process.kill(victim === 'worker' ? first.workerPid : first.servicePid, 'SIGKILL')
    const failed = await interrupted.finished
    assert.equal(failed.ok, false)
    assert.notEqual(failed.status, 0)
    assert.deepEqual(artifacts(directory), before)
    fs.rmSync(path.join(directory, 'pause-compiler'))
    const retired = processes.filter(pid => victim === 'service' || pid !== first.servicePid)
    await waitFor(() => retired.every(pid => !alive(pid)))
    const recovered = good(await run(directory, ['--force']))
    assert.deepEqual(recovered.built, ['alpha', 'beta'])
    assert.deepEqual(artifacts(directory), before)
    assert.deepEqual(fs.readdirSync(path.join(directory, '.build')), [])
  })
}

test('WHAT[build-015] project budget rotates at a build boundary and idle exit releases the compiler', { timeout: 60000 }, async t => {
  const directory = fixture(t)
  const options = { env: { WANXIANGLI_CHECKER_PROJECT_LIMIT: '3', WANXIANGLI_BUILD_IDLE_MS: '600000' } }
  const first = good(await run(directory, [], options))
  change(directory, 'alpha', 2)
  const second = good(await run(directory, [], options))
  assert.equal(second.compiledBy, first.compiledBy)
  assert.equal(second.retired, true)
  assert.equal(second.workerPid, null)
  await waitFor(() => !alive(first.workerPid))
  change(directory, 'beta', 3)
  const third = good(await run(directory, [], options))
  assert.equal(third.servicePid, first.servicePid)
  assert.notEqual(third.workerPid, first.workerPid)
  assert.equal(third.generation, 2)
  good(await run(directory, ['--stop'], options))
  const idleOptions = { env: { WANXIANGLI_BUILD_IDLE_MS: '300' } }
  const idle = good(await run(directory, ['--force'], idleOptions))
  await waitFor(() => !alive(idle.servicePid) && !alive(idle.workerPid))
  assert.equal(fs.existsSync(path.join(directory, '.build-service/active')), false)
  change(directory, 'alpha', 4)
  const resumed = good(await run(directory))
  assert.deepEqual(resumed.built, ['alpha'])
  assert.deepEqual(values(directory), [4, 3])
})
