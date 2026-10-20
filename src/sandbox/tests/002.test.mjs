import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Sandbox } from './support.mjs'

const law = Sandbox()
const BASE = `class JsProgram {
  constructor(api) { this._api = api; }
  async cat(path) { return await this._api.cat(path); }
}`

test('SPEC[sandbox-002] sync infinite loop dies under the vm timeout', async () => {
  const src = `class Js extends JsProgram { async run() { while (true) {} } }`
  const t0 = Date.now()
  const handle = law.run({ cat: async () => 'x' }, 200, Date.now() + 2000, BASE, src)
  await assert.rejects(() => handle.programPromise, (e) => e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT')
  assert.ok(Date.now() - t0 < 5000)
})

test('SPEC[sandbox-002] post-await sync loop dies under the driven timeout', async () => {
  // afterEvaluate + node:test async_hooks: run the probe in a child process.
  const dist = fileURLToPath(new URL('../../../dist/sandbox/Sandbox.js', import.meta.url))
  const script = `
    import { Sandbox } from ${JSON.stringify(dist)};
    const law = Sandbox();
    const BASE = ${JSON.stringify(BASE)};
    const src = 'class Js extends JsProgram { async run() { await this.cat(\\'a\\'); while (true) {} } }';
    const t0 = Date.now();
    const handle = law.run({ cat: async () => 'x' }, 200, Date.now() + 2000, BASE, src);
    try {
      await handle.programPromise;
      process.exit(3);
    } catch (e) {
      if (!e || e.code !== 'ERR_SCRIPT_EXECUTION_TIMEOUT') process.exit(4);
      if (Date.now() - t0 >= 5000) process.exit(5);
      process.exit(0);
    }
  `
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 10000,
  })
  assert.equal(r.status, 0, r.stderr || r.stdout || 'child failed')
})
