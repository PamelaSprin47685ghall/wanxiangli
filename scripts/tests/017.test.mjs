import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { request } from '../build-state.mjs'
import { fixture, start, run, good, change, values, artifacts, alive, waitFor } from './resident-fixture.mjs'

function fourModules(t, gated = false) {
  const root = fixture(t)
  for (const [name, value] of [['gamma', 7], ['delta', 9]]) {
    fs.cpSync(path.join(root, 'src/alpha'), path.join(root, 'src', name), { recursive: true })
    change(root, name, value)
  }
  if (gated) {
    const file = path.join(root, 'scripts/compiler.mjs')
    const source = fs.readFileSync(file, 'utf8')
    const anchor = 'async compile(project, outDir) {'
    assert.ok(source.includes(anchor))
    fs.writeFileSync(file, "import parallelFs from 'node:fs'\nimport { setTimeout as parallelPause } from 'node:timers/promises'\n" + source.replace(anchor, anchor + `
      const moduleName = path.basename(path.dirname(project))
      if (parallelFs.existsSync('gate')) {
        parallelFs.writeFileSync('entered-' + moduleName, String(process.pid))
        while (parallelFs.existsSync('gate')) await parallelPause(10)
      }
`))
  }
  return root
}
const usage = root => JSON.parse(fs.readFileSync(path.join(root, '.build-service/usage.json')))
const names = ['alpha', 'beta', 'delta', 'gamma']

test('WHAT[build-017] invalid parallel options fail before starting a service and requests are validated', async t => {
  const root = fixture(t)
  for (const args of [['--jobs'], ['--jobs', '0'], ['--jobs=-1'], ['--jobs=5'], ['--jobs=1.5'],
    ['--parallel', '--jobs=2'], ['--parallel', '--parallel'], ['--parallel', '--status'], ['--jobs=1', '--stop']]) {
    const result = await run(root, args)
    assert.equal(result.ok, false, JSON.stringify(args))
    assert.notEqual(result.status, 0)
    assert.equal(fs.existsSync(path.join(root, '.build-service')), false)
  }
  good(await run(root))
  const before = artifacts(root)
  const rejected = await request(root, { op: 'build', selected: [], force: true, jobs: 99 })
  assert.equal(rejected.ok, false)
  assert.match(rejected.error, /Invalid build request/)
  assert.deepEqual(artifacts(root), before)
})

test('WHAT[build-017] 1/2/4 processes emit identical bytes and incremental requests use only needed workers', { timeout: 60000 }, async t => {
  const root = fourModules(t)
  const serial = good(await run(root))
  const expected = artifacts(root)
  for (const jobs of [2, 4]) {
    const result = good(await run(root, ['--force', '--jobs', String(jobs)], { npm: true }))
    assert.equal(result.jobs, jobs)
    assert.equal(new Set(result.compiledByPids).size, jobs)
    assert.equal(result.workerPid, serial.workerPid)
    assert.deepEqual(artifacts(root), expected)
    await waitFor(() => result.compiledByPids.slice(1).every(pid => !alive(pid)))
    const sample = usage(root).samples.at(-1)
    assert.equal(sample.jobs, jobs)
    assert.equal(sample.workers.length, jobs)
    assert.equal(sample.reuse.created, jobs - 1)
    assert.equal(sample.reuse.reusedAcrossBuilds, 4 / jobs)
    assert.equal(sample.workerMemory.rss, sample.workers.reduce((sum, worker) => sum + worker.memory.rss, 0))
  }
  const before = fs.readFileSync(path.join(root, '.build-service/usage.json'))
  const cached = good(await run(root, ['--parallel']))
  assert.equal(cached.jobs, 0)
  assert.deepEqual(cached.compiledByPids, [])
  assert.deepEqual(fs.readFileSync(path.join(root, '.build-service/usage.json')), before)
  change(root, 'alpha', 42)
  const partial = good(await run(root, ['--jobs=4']))
  assert.equal(partial.jobs, 1)
  assert.equal(partial.compiledBy, serial.workerPid)
  assert.deepEqual(partial.built, ['alpha'])
  assert.deepEqual(values(root), [42, 3])
  const incremental = artifacts(root)
  good(await run(root, ['--force', '--jobs=1']))
  assert.deepEqual(artifacts(root), incremental)
  change(root, 'beta', 31)
  change(root, 'gamma', 41)
  const multiple = good(await run(root, ['--jobs=4']))
  assert.equal(multiple.jobs, 2)
  assert.deepEqual(multiple.built, ['beta', 'gamma'])
  assert.deepEqual(values(root, 'beta'), [31, 3])
  assert.deepEqual(values(root, 'gamma'), [41, 3])
  const multipleOutputs = artifacts(root)
  good(await run(root, ['--force', '--jobs=1']))
  assert.deepEqual(artifacts(root), multipleOutputs)
})

test('WHAT[build-017] independent parallel commands still share one publisher and one retained checker', { timeout: 60000 }, async t => {
  const root = fourModules(t)
  const results = (await Promise.all([run(root, ['--parallel', '--force']), run(root, ['--parallel', '--force'])])).map(good)
  assert.equal(new Set(results.map(result => result.servicePid)).size, 1)
  assert.equal(new Set(results.map(result => result.workerPid)).size, 1)
  assert.ok(results.every(result => result.jobs === 2))
  await waitFor(() => results.every(result => !alive(result.compiledByPids[1])))
  const expected = artifacts(root)
  good(await run(root, ['--force']))
  assert.deepEqual(artifacts(root), expected)
})

for (const victim of ['worker', 'service']) {
  test(`WHAT[build-017] four compilers overlap and killing the ${victim} reclaims every compiler without publishing`, { timeout: 60000 }, async t => {
    const root = fourModules(t, true)
    const first = good(await run(root))
    const expected = artifacts(root)
    change(root, 'alpha', 8)
    fs.writeFileSync(path.join(root, 'gate'), '')
    const running = start(root, ['--force', '--jobs=4'])
    const pids = await waitFor(() => names.every(name => fs.existsSync(path.join(root, 'entered-' + name)))
      && names.map(name => Number(fs.readFileSync(path.join(root, 'entered-' + name), 'utf8'))))
    assert.equal(new Set(pids).size, 4, 'all four compilers must enter while the gate is closed')
    process.kill(victim === 'service' ? first.servicePid : pids[2], 'SIGKILL')
    const failed = await running.finished
    assert.equal(failed.ok, false)
    await waitFor(() => pids.every(pid => !alive(pid)))
    assert.deepEqual(artifacts(root), expected)
    fs.rmSync(path.join(root, 'gate'))
    const recovered = good(await run(root, ['--jobs=4']))
    assert.equal(recovered.jobs, victim === 'service' ? 1 : 4)
    assert.deepEqual(values(root), [8, 3])
    const restored = artifacts(root)
    good(await run(root, ['--force']))
    assert.deepEqual(artifacts(root), restored)
    assert.deepEqual(fs.readdirSync(path.join(root, '.build')), [])
  })
}

test('WHAT[build-017] compile errors and edits during parallel compilation preserve previous outputs', { timeout: 60000 }, async t => {
  const root = fourModules(t, true)
  good(await run(root))
  const expected = artifacts(root)
  change(root, 'beta', 'notDefined')
  const failed = await run(root, ['--force', '--parallel'])
  assert.equal(failed.ok, false)
  assert.deepEqual(artifacts(root), expected)
  assert.equal(good(await run(root, ['--status'])).workerPid, null)
  change(root, 'beta', 2)
  fs.writeFileSync(path.join(root, 'gate'), '')
  const running = start(root, ['--force', '--jobs=4'])
  await waitFor(() => names.every(name => fs.existsSync(path.join(root, 'entered-' + name))))
  change(root, 'gamma', 11)
  fs.rmSync(path.join(root, 'gate'))
  const changed = await running.finished
  assert.equal(changed.ok, false)
  assert.match(changed.error, /Inputs changed during build/)
  assert.deepEqual(artifacts(root), expected)
  good(await run(root, ['--parallel']))
  assert.deepEqual(values(root, 'beta'), [2, 3])
  assert.deepEqual(values(root, 'gamma'), [11, 3])
})
