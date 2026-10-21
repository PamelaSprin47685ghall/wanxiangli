import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Sandbox } from './support.mjs'

// SPEC[sandbox-004]: between wakes the driver sleeps. An idle program (parked on a
// host promise nobody settles yet) neither spins the event loop nor keeps the
// process alive, and a program still finishes when its host promise settles late
// or when the host calls back into program code.
// Base-red on 0.62.0: the driver re-entered the context on every setImmediate tick
// until the deadline, so the first child below lived ~60 s at 100% CPU.

const dist = fileURLToPath(new URL('../../../dist/sandbox/Sandbox.js', import.meta.url))
const BASE = `class JsProgram {
  constructor(api) { this._api = api; }
  async wait() { return await this._api.wait(); }
  async cat(path) { return await this._api.cat(path); }
  async listen(fn) { return await this._api.listen(fn); }
}`

const child = (body) => spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { Sandbox } from ${JSON.stringify(dist)};
  const law = Sandbox();
  const BASE = ${JSON.stringify(BASE)};
  ${body}
`], { encoding: 'utf8', timeout: 20000 })

test('SPEC[sandbox-004] an idle program neither spins nor keeps the process alive', () => {
  const r = child(`
    const src = 'class Js extends JsProgram { async run() { await this.wait(); return 1; } }';
    const t0 = Date.now();
    const cpu0 = process.cpuUsage();
    law.run({ wait: () => new Promise(() => {}) }, 2000, Date.now() + 60_000, BASE, src);
    setTimeout(() => {
      const cpu = process.cpuUsage(cpu0);
      console.log(JSON.stringify({ cpuMs: (cpu.user + cpu.system) / 1000 }));
    }, 1000);
    process.on('exit', () => console.log(JSON.stringify({ exitMs: Date.now() - t0 })));
  `)
  assert.equal(r.status, 0, r.stderr)
  const lines = r.stdout.trim().split('\n').map((line) => JSON.parse(line))
  const { cpuMs } = lines.find((line) => 'cpuMs' in line)
  const { exitMs } = lines.find((line) => 'exitMs' in line)
  assert.ok(cpuMs < 300, `idle second used ${cpuMs} ms of CPU`)
  assert.ok(exitMs < 5000, `process lived ${exitMs} ms after the idle program started`)
})

test('SPEC[sandbox-004] a late-settling host promise and a host callback still wake the program', async () => {
  const law = Sandbox()
  const late = law.run({ cat: () => new Promise((resolve) => setTimeout(() => resolve('late'), 300)) },
    2000, Date.now() + 60_000, BASE,
    'class Js extends JsProgram { async run() { const a = await this.cat("x"); const b = await this.cat("y"); return a + b; } }')
  assert.equal(JSON.parse(await late.programPromise), 'latelate')

  let callback
  const called = law.run({ listen: (fn) => { callback = fn; return new Promise(() => {}) } },
    2000, Date.now() + 60_000, BASE,
    'class Js extends JsProgram { async run() { let hit; const seen = new Promise((r) => { hit = r; }); this.listen((v) => hit(v)); return await seen; } }')
  setTimeout(() => callback('ping'), 200)
  assert.equal(JSON.parse(await called.programPromise), 'ping')
})

test('SPEC[sandbox-004] an idle program past its deadline still times out while the process lives', async () => {
  const law = Sandbox()
  const keepAlive = setInterval(() => {}, 1000)
  try {
    const handle = law.run({ wait: () => new Promise(() => {}) }, 2000, Date.now() + 300, BASE,
      'class Js extends JsProgram { async run() { await this.wait(); return 1; } }')
    const t0 = Date.now()
    await assert.rejects(() => handle.programPromise, (e) => e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT')
    assert.ok(Date.now() - t0 < 2000)
  } finally { clearInterval(keepAlive) }
})
