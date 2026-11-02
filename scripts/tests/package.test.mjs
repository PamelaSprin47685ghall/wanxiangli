import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packedPackage } from './package-metadata.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const { NODE_PATH, NODE_OPTIONS, ...cleanEnvironment } = process.env

function succeed(result) {
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return result.stdout
}

test('installed prefix, handle and change owners complete their public lifecycles', { timeout: 90000 }, async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'wanxiangli-prefix-handles-package-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 })))
  const consumer = path.join(temporary, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'prefix-handles-consumer', private: true, type: 'module' }))
  succeed(spawnSync(npm, ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const cases = [['prefix-history', 'prefixHistory'], ['child-run-set', 'childRunSet'], ['durable-handles', 'durableHandles'], ['change', 'change']]
  for (const [name] of cases) {
    for (const suffix of ['mjs', 'ts']) {
      const file = `${name}-consumer.${suffix}`
      copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
    }
  }
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', ...cases.map(([name]) => `${name}-consumer.ts`)], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { env: cleanEnvironment, encoding: 'utf8' }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its prefix and handle consumers were not run.')
  for (const [runtime, executable] of runtimes) {
    for (const [name, property] of cases) {
      await t.test(`${runtime}: ${name}`, () => {
        const output = succeed(spawnSync(executable, [path.join(consumer, `${name}-consumer.mjs`)], { cwd: tmpdir(), env: cleanEnvironment, encoding: 'utf8', timeout: 10000 }))
        assert.deepEqual(JSON.parse(output), { [property]: true })
      })
    }
  }
})

test('installed FissionLifecycle runs two lanes through shared results and owner convergence', { timeout: 90000 }, async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'wanxiangli-fission-lifecycle-package-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 })))
  const consumer = path.join(temporary, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'fission-lifecycle-consumer', private: true, type: 'module' }))
  succeed(spawnSync(npm, ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  for (const file of ['fission-lifecycle-consumer.mjs', 'fission-lifecycle-consumer.ts']) copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'fission-lifecycle-consumer.ts'], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { env: cleanEnvironment, encoding: 'utf8' }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its Fission lifecycle consumer was not run.')
  for (const [name, executable] of runtimes) {
    await t.test(name, () => {
      const output = succeed(spawnSync(executable, [path.join(consumer, 'fission-lifecycle-consumer.mjs')], { cwd: tmpdir(), env: cleanEnvironment, encoding: 'utf8', timeout: 10000 }))
      assert.deepEqual(JSON.parse(output), { fissionLifecycle: true })
    })
  }
})

test('installed DelegateInvocation owns observed acceptance and terminal settlement', { timeout: 90000 }, async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'wanxiangli-delegate-invocation-package-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 })))
  const consumer = path.join(temporary, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'delegate-invocation-consumer', private: true, type: 'module' }))
  succeed(spawnSync(npm, ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  for (const file of ['delegate-invocation-consumer.mjs', 'delegate-invocation-consumer.ts']) copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'delegate-invocation-consumer.ts'], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { env: cleanEnvironment, encoding: 'utf8' }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its delegate invocation consumer was not run.')
  for (const [name, executable] of runtimes) {
    await t.test(name, () => {
      const output = succeed(spawnSync(executable, [path.join(consumer, 'delegate-invocation-consumer.mjs')], { cwd: tmpdir(), env: cleanEnvironment, encoding: 'utf8', timeout: 10000 }))
      assert.deepEqual(JSON.parse(output), { delegateInvocation: true })
    })
  }
})

test('installed PairGuidance owns history and commits rendered occurrences', { timeout: 90000 }, async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'wanxiangli-pair-guidance-package-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 })))
  const consumer = path.join(temporary, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'pair-guidance-consumer', private: true, type: 'module' }))
  succeed(spawnSync(npm, ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  for (const file of ['pair-guidance-consumer.mjs', 'pair-guidance-consumer.ts']) copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'pair-guidance-consumer.ts'], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { env: cleanEnvironment, encoding: 'utf8' }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its pair guidance consumer was not run.')
  for (const [name, executable] of runtimes) {
    await t.test(name, () => {
      const output = succeed(spawnSync(executable, [path.join(consumer, 'pair-guidance-consumer.mjs')], { cwd: tmpdir(), env: cleanEnvironment, encoding: 'utf8', timeout: 10000 }))
      assert.deepEqual(JSON.parse(output), { pairGuidance: true })
    })
  }
})

test('installed JournalSession commits, notifies, recovers and closes through the public entry', { timeout: 90000 }, async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'wanxiangli-journal-session-package-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 })))
  const consumer = path.join(temporary, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'journal-session-consumer', private: true, type: 'module' }))
  succeed(spawnSync(npm, ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  for (const file of ['journal-session-consumer.mjs', 'journal-session-consumer.ts']) {
    copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  }
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'journal-session-consumer.ts'], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { env: cleanEnvironment, encoding: 'utf8' }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its journal session consumer was not run.')
  for (const [name, executable] of runtimes) {
    await t.test(name, () => {
      const output = succeed(spawnSync(executable, [path.join(consumer, 'journal-session-consumer.mjs')], { cwd: tmpdir(), env: cleanEnvironment, encoding: 'utf8', timeout: 10000 }))
      assert.deepEqual(JSON.parse(output), { journalSession: true })
    })
  }
})

test('installed LocalEventStore appends, reopens and consumes the physical entry', { timeout: 90000 }, async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'wanxiangli-local-eventstore-package-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 })))
  const consumer = path.join(temporary, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'local-eventstore-consumer', private: true, type: 'module' }))
  succeed(spawnSync(npm, ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  for (const file of ['local-eventstore-consumer.mjs', 'local-eventstore-consumer.ts']) {
    copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  }
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'local-eventstore-consumer.ts'], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { env: cleanEnvironment, encoding: 'utf8' }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its local event-store consumer was not run.')
  for (const [name, executable] of runtimes) {
    await t.test(name, () => {
      const output = succeed(spawnSync(executable, [path.join(consumer, 'local-eventstore-consumer.mjs')], { cwd: tmpdir(), env: cleanEnvironment, encoding: 'utf8', timeout: 10000 }))
      assert.deepEqual(JSON.parse(output), { localEventStore: true })
    })
  }
})

test('installed ExecutionRouting acquires, commits, runs a step and releases exact capacity', { timeout: 90000 }, async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'wanxiangli-routing-package-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 })))
  const consumer = path.join(temporary, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'routing-consumer', private: true, type: 'module' }))
  succeed(spawnSync(npm, ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  for (const file of ['execution-routing-consumer.mjs', 'execution-routing-consumer.ts']) {
    copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  }
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'execution-routing-consumer.ts'], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { env: cleanEnvironment, encoding: 'utf8' }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its routing consumer was not run.')
  for (const [name, executable] of runtimes) {
    await t.test(name, () => {
      const output = succeed(spawnSync(executable, [path.join(consumer, 'execution-routing-consumer.mjs')], { cwd: tmpdir(), env: cleanEnvironment, encoding: 'utf8', timeout: 10000 }))
      assert.deepEqual(JSON.parse(output), { executionRouting: true })
    })
  }
})

test('installed DispatchAttempt sends and confirms through the public entry', { timeout: 90000 }, async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'wanxiangli-dispatch-package-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 })))
  assert.ok(packed.files.some(file => file.path === 'dist/dispatch/Dispatch.js'))
  assert.ok(packed.files.some(file => file.path === 'src/dispatch/index.d.ts'))
  const consumer = path.join(temporary, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'dispatch-consumer', private: true, type: 'module' }))
  succeed(spawnSync(npm, ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  for (const file of ['dispatch-attempt-consumer.mjs', 'dispatch-attempt-consumer.ts']) {
    copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  }
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'dispatch-attempt-consumer.ts'], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { env: cleanEnvironment, encoding: 'utf8' }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its dispatch consumer was not run.')
  for (const [name, executable] of runtimes) {
    await t.test(name, () => {
      const output = succeed(spawnSync(executable, [path.join(consumer, 'dispatch-attempt-consumer.mjs')], { cwd: tmpdir(), env: cleanEnvironment, encoding: 'utf8', timeout: 10000 }))
      assert.deepEqual(JSON.parse(output), { dispatchAttempt: true })
    })
  }
})

test('installed AttachmentSessions creates, reuses, and retires through the public entry', { timeout: 90000 }, async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'wanxiangli-attachment-package-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 })))
  assert.ok(packed.files.some(file => file.path === 'dist/attachment-lease/AttachmentLeaseLaw.js'))
  assert.ok(packed.files.some(file => file.path === 'src/attachment-lease/index.d.ts'))
  const consumer = path.join(temporary, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'attachment-consumer', private: true, type: 'module' }))
  succeed(spawnSync(npm, ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  for (const file of ['attachment-sessions-consumer.mjs', 'attachment-sessions-consumer.ts']) {
    copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  }
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'attachment-sessions-consumer.ts'], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { env: cleanEnvironment, encoding: 'utf8' }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its attachment consumer was not run.')
  for (const [name, executable] of runtimes) {
    await t.test(name, () => {
      const output = succeed(spawnSync(executable, [path.join(consumer, 'attachment-sessions-consumer.mjs')], { cwd: tmpdir(), env: cleanEnvironment, encoding: 'utf8', timeout: 10000 }))
      assert.deepEqual(JSON.parse(output), { attachmentSessions: true })
    })
  }
})

test('SPEC[build-002] an installed tarball survives a real effect and process death without dispatching twice', { timeout: 90000, skip: process.platform === 'win32' }, async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'wanxiangli-package-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 })))
  assert.ok(packed.files.some(file => file.path === 'dist/lifecycle/Work.js'))
  assert.ok(packed.files.some(file => file.path === 'dist/eventstore/SqliteJournal.js'))
  assert.ok(packed.files.some(file => file.path === 'dist/assembly/DurableWork.js'))
  for (const file of packed.files) assert.doesNotMatch(file.path, /\.fs(?:proj|i)?$|^scripts\/|^node_modules\//)
  const consumer = path.join(temporary, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'independent-consumer', private: true, type: 'module' }))
  succeed(spawnSync(npm, ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const installed = JSON.parse(readFileSync(path.join(consumer, 'node_modules/wanxiangli/package.json'), 'utf8'))
  assert.deepEqual(installed.dependencies ?? {}, {})
  assert.deepEqual(installed.peerDependencies ?? {}, {})
  assert.equal(existsSync(path.join(consumer, 'node_modules/esbuild')), false)
  assert.equal(existsSync(path.join(consumer, 'node_modules/wanxiangli/scripts')), false)
  for (const file of ['consumer.mjs', 'consumer.ts']) copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'consumer.ts'], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const script = path.join(consumer, 'consumer.mjs')
  const runtimes = [ ['node', process.execPath] ]
  const bun = spawnSync('bun', ['--version'], { env: cleanEnvironment, encoding: 'utf8' })
  if (bun.status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; only the Node package consumer can be proven in this environment.')
  for (const [runtime, executable] of runtimes) {
    await t.test(`installed consumer on ${runtime}`, async subtest => {
      const database = path.join(temporary, `${runtime}.sqlite`)
      const effects = path.join(temporary, `${runtime}-effects.jsonl`)
      const child = spawn(executable, [script, runtime, 'start', database, effects], { cwd: tmpdir(), env: cleanEnvironment, stdio: ['ignore', 'pipe', 'pipe'] })
      let diagnostics = ''
      child.stderr.on('data', data => { diagnostics += data })
      subtest.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit')
          child.kill('SIGKILL')
          await exited
        }
      })
      const lines = createInterface({ input: child.stdout })
      subtest.after(() => lines.close())
      const reached = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No effect barrier reached\n${diagnostics}`)), 10000)
        lines.once('line', value => {
          clearTimeout(timer)
          try { resolve(JSON.parse(value)) } catch (error) { reject(error) }
        })
        child.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`Consumer exited ${code}/${signal}\n${diagnostics}`)) })
        child.once('error', error => { clearTimeout(timer); reject(error) })
      })
      assert.equal(reached.phase, 'effect-completed')
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
      const recovery = succeed(spawnSync(executable, [script, runtime, 'recover', database, effects], { cwd: tmpdir(), env: cleanEnvironment, encoding: 'utf8', timeout: 10000 }))
      assert.equal(JSON.parse(recovery.trim()).externalEffects, 1)
      assert.equal(readFileSync(effects, 'utf8').trim().split('\n').length, 1)
    })
  }
})

test('installed ProviderRecovery composes a durable budget and one stopped dispatch', { timeout: 90000 }, async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'wanxiangli-provider-recovery-package-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const packed = packedPackage(succeed(spawnSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 })))
  const consumer = path.join(temporary, 'consumer')
  mkdirSync(consumer)
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'provider-recovery-consumer', private: true, type: 'module' }))
  succeed(spawnSync(npm, ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  for (const file of ['provider-recovery-consumer.mjs', 'provider-recovery-consumer.ts']) copyFileSync(path.join(root, 'scripts/tests', file), path.join(consumer, file))
  succeed(spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', 'provider-recovery-consumer.ts'], { cwd: consumer, env: cleanEnvironment, encoding: 'utf8', timeout: 30000 }))
  const runtimes = [['node', process.execPath]]
  if (spawnSync('bun', ['--version'], { env: cleanEnvironment, encoding: 'utf8' }).status === 0) runtimes.push(['bun', 'bun'])
  else t.diagnostic('Bun is absent; its provider recovery consumer was not run.')
  for (const [name, executable] of runtimes) {
    await t.test(name, () => {
      const output = succeed(spawnSync(executable, [path.join(consumer, 'provider-recovery-consumer.mjs')], { cwd: tmpdir(), env: cleanEnvironment, encoding: 'utf8', timeout: 10000 }))
      assert.deepEqual(JSON.parse(output), { providerRecovery: true })
    })
  }
})
