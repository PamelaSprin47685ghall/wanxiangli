import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createUsage } from '../build-usage.mjs'
import { fixture, run, good, change, alive, waitFor, values } from './resident-fixture.mjs'

const usageFile = root => path.join(root, '.build-service/usage.json')
const usage = root => JSON.parse(fs.readFileSync(usageFile(root), 'utf8'))

test('WHAT[build-016] status polling neither renews idle time nor changes compilation records', { timeout: 60000 }, async t => {
  const root = fixture(t)
  const options = { env: { WANXIANGLI_BUILD_IDLE_MS: '1200' } }
  const first = good(await run(root, [], options))
  const before = fs.readFileSync(usageFile(root), 'utf8')
  const deadline = Date.now() + 5000
  let queries = 0
  while (alive(first.servicePid) && Date.now() < deadline) {
    await run(root, ['--status'], options)
    queries++
    await delay(50)
  }
  assert.ok(queries >= 2)
  assert.equal(alive(first.servicePid), false, 'status polling kept the service alive')
  await waitFor(() => !alive(first.workerPid))
  assert.equal(fs.readFileSync(usageFile(root), 'utf8'), before)
  assert.equal(good(await run(root, ['--status'], options)).running, false)
})

test('WHAT[build-016] real compiles record reuse and memory across no-ops, failures and restarts', { timeout: 60000 }, async t => {
  const root = fixture(t)
  good(await run(root))
  const first = usage(root).samples[0]
  assert.equal(first.projects, 2)
  assert.deepEqual(first.reuse, { created: 1, reused: 1, reusedAcrossBuilds: 0 })
  assert.equal(first.intervalMs, null)
  assert.equal(first.idleMs, null)
  assert.ok(first.workerMemory.rss > 0)
  assert.ok(first.workerMemory.heapUsed > 0)
  const before = fs.readFileSync(usageFile(root), 'utf8')
  good(await run(root))
  assert.equal(fs.readFileSync(usageFile(root), 'utf8'), before)
  change(root, 'alpha', 2)
  good(await run(root))
  const second = usage(root).samples[1]
  assert.equal(second.intervalMs, second.startedAt - first.startedAt)
  assert.equal(second.idleMs, second.startedAt - first.finishedAt)
  assert.deepEqual(second.reuse, { created: 0, reused: 1, reusedAcrossBuilds: 1 })
  change(root, 'alpha', 'undefinedValue')
  assert.equal((await run(root)).ok, false)
  assert.equal(usage(root).samples.at(-1).outcome, 'failure')
  good(await run(root, ['--stop']))
  change(root, 'alpha', 3)
  good(await run(root))
  const data = usage(root)
  assert.equal(data.totals.attempts, 4)
  assert.equal(data.totals.success, 3)
  assert.equal(data.totals.failure, 1)
  assert.equal(data.totals.created, 2)
  assert.equal(data.totals.reusedAcrossBuilds, 2)
  assert.equal(data.samples.at(-1).reuse.created, 1)
  assert.ok(data.samples.at(-1).intervalMs > 0)
  assert.deepEqual(values(root), [3, 3])
})

test('WHAT[build-016] records stay bounded and preserve an interrupted attempt without inventing reuse', t => {
  const root = fixture(t)
  const file = usageFile(root)
  createUsage(file).begin({ workerPid: 1, projects: 1 })
  const recorder = createUsage(file)
  const result = { outcome: 'success', reuse: { created: 0, reused: 1, reusedAcrossBuilds: 1 } }
  recorder.begin({ workerPid: 2, projects: 1 })(result)
  assert.equal(usage(root).samples[0].outcome, 'unknown')
  assert.equal(usage(root).samples[1].idleMs, null)
  for (let index = 0; index < 260; index++) recorder.begin({ workerPid: 2, projects: 1 })(result)
  const data = usage(root)
  assert.equal(data.samples.length, 256)
  assert.equal(data.totals.attempts, 262)
  assert.equal(data.totals.unknown, 1)
  assert.equal(data.totals.reusedAcrossBuilds, 261)
  assert.equal(data.totals.missingReuseReports, 1)
})

test('WHAT[build-016] unavailable usage storage does not fail or alter compilation', { timeout: 60000 }, async t => {
  const root = fixture(t)
  fs.mkdirSync(usageFile(root), { recursive: true })
  good(await run(root))
  assert.match(fs.readFileSync(path.join(root, '.build-service/service.log'), 'utf8'), /Build usage recording disabled/)
  assert.deepEqual(values(root), [1, 3])
})
