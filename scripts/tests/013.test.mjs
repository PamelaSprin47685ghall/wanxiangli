import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { release } from '../build-state.mjs'
import { fixture, start, run, good, change, values, artifacts, alive, waitFor } from './resident-fixture.mjs'

test('WHAT[build-013] four simultaneous cold npm clients elect one service and compile each module once', { timeout: 60000 }, async t => {
  const directory = fixture(t)
  const results = (await Promise.all(Array.from({ length: 4 }, () => run(directory, [], { npm: true })))).map(good)
  assert.equal(new Set(results.map(result => result.servicePid)).size, 1)
  assert.equal(new Set(results.map(result => result.workerPid)).size, 1)
  assert.equal(new Set(results.map(result => result.token)).size, 1)
  assert.equal(results.reduce((sum, result) => sum + result.built.length, 0), 2)
  const expected = artifacts(directory)
  const forced = (await Promise.all(Array.from({ length: 4 }, () => run(directory, ['--force'], { npm: true })))).map(good)
  assert.equal(new Set(forced.map(result => result.servicePid)).size, 1)
  assert.equal(new Set(forced.map(result => result.compiledBy)).size, 1)
  assert.ok(forced.every(result => result.checkers === 1))
  assert.deepEqual(forced.map(result => result.completed).sort((a, b) => a - b), [4, 6, 8, 10])
  assert.deepEqual(artifacts(directory), expected)
})

test('WHAT[build-013] queued requests read source after earlier requests finish', { timeout: 60000 }, async t => {
  const directory = fixture(t, { pause: true })
  good(await run(directory))
  change(directory, 'alpha', 2)
  fs.writeFileSync(path.join(directory, 'pause-compiler'), '')
  const first = start(directory, ['alpha'])
  await waitFor(() => fs.existsSync(path.join(directory, 'compiler-paused')))
  const second = start(directory, ['beta'])
  change(directory, 'beta', 3)
  fs.rmSync(path.join(directory, 'pause-compiler'))
  const a = good(await first.finished)
  const b = good(await second.finished)
  assert.equal(a.workerPid, b.workerPid)
  assert.deepEqual(a.built, ['alpha'])
  assert.deepEqual(b.built, ['beta'])
  assert.deepEqual(values(directory), [2, 3])
  assert.deepEqual(values(directory, 'beta'), [3, 3])
})

for (const victim of ['worker', 'service']) {
  test(`WHAT[build-013] killing the ${victim} during a build fails the client and permits concurrent recovery`, { timeout: 60000 }, async t => {
    const directory = fixture(t, { pause: true })
    const first = good(await run(directory))
    const previous = JSON.parse(fs.readFileSync(path.join(directory, '.build-service/active/owner.json')))
    const before = artifacts(directory)
    change(directory, 'alpha', 2)
    fs.writeFileSync(path.join(directory, 'pause-compiler'), '')
    const broken = start(directory)
    const workerPid = await waitFor(() => {
      const file = path.join(directory, 'compiler-paused')
      return fs.existsSync(file) && Number(fs.readFileSync(file, 'utf8'))
    })
    process.kill(victim === 'worker' ? workerPid : first.servicePid, 'SIGKILL')
    const failed = await broken.finished
    assert.equal(failed.ok, false)
    assert.notEqual(failed.status, 0)
    assert.deepEqual(artifacts(directory), before)
    fs.rmSync(path.join(directory, 'pause-compiler'))
    await waitFor(() => !alive(workerPid))
    const recovered = (await Promise.all(Array.from({ length: 4 }, () => run(directory, [], { npm: true })))).map(good)
    assert.equal(new Set(recovered.map(result => result.servicePid)).size, 1)
    assert.equal(recovered.reduce((sum, result) => sum + result.built.length, 0), 1)
    assert.deepEqual(values(directory), [2, 3])
    if (victim === 'service') {
      release(directory, previous)
      const state = good(await run(directory, ['--status']))
      assert.equal(state.servicePid, recovered[0].servicePid)
      assert.ok(alive(state.servicePid))
    }
    assert.deepEqual(fs.readdirSync(path.join(directory, '.build')), [])
  })
}

test('WHAT[build-013] a recycled PID does not make a dead service appear alive', { timeout: 60000 }, async t => {
  const directory = fixture(t)
  const first = good(await run(directory))
  process.kill(first.servicePid, 'SIGKILL')
  await waitFor(() => !alive(first.servicePid) && !alive(first.workerPid))
  const file = path.join(directory, '.build-service/active/owner.json')
  const old = JSON.parse(fs.readFileSync(file))
  fs.writeFileSync(file, JSON.stringify({ ...old, pid: process.pid, started: 'an earlier process with this PID' }))
  const recovered = good(await run(directory))
  assert.notEqual(recovered.servicePid, first.servicePid)
  assert.deepEqual(recovered.built, [])
  assert.equal(recovered.workerPid, null)
  assert.ok(alive(process.pid))
})

test('WHAT[build-013] a disconnected caller does not block another queued client', { timeout: 60000 }, async t => {
  const directory = fixture(t, { pause: true })
  const first = good(await run(directory))
  change(directory, 'alpha', 2)
  fs.writeFileSync(path.join(directory, 'pause-compiler'), '')
  const interrupted = start(directory, ['alpha'])
  const discarded = interrupted.finished.catch(error => error)
  await waitFor(() => fs.existsSync(path.join(directory, 'compiler-paused')))
  interrupted.child.kill('SIGTERM')
  const next = start(directory, ['alpha', '--force'])
  fs.rmSync(path.join(directory, 'pause-compiler'))
  assert.ok(await discarded instanceof Error)
  const result = good(await next.finished)
  assert.equal(result.servicePid, first.servicePid)
  assert.equal(result.workerPid, first.workerPid)
  assert.deepEqual(values(directory), [2, 3])
})
