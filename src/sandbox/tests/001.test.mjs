import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Sandbox } from './support.mjs'
import { runNaive } from './support/naive.mjs'

const law = Sandbox()
const BASE = `class JsProgram {
  constructor(api) { this._api = api; }
  async ls(path) { return await this._api.ls(path); }
  async cat(path) { return await this._api.cat(path); }
}`

async function runMembrane(body, api, deadlineMs = 2000, deadlineEpochMs = Date.now() + 60_000) {
  const src = `class Js extends JsProgram { async run() { ${body} } }`
  const handle = law.run(api, deadlineMs, deadlineEpochMs, BASE, src)
  try {
    const json = await handle.programPromise
    if (typeof json === 'string' && json.includes('__jsProgramFailed')) {
      return { ok: false, json: JSON.parse(json) }
    }
    return { ok: true, value: JSON.parse(json) }
  } catch (e) {
    return { ok: false, timeout: e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT', err: String(e && e.message || e) }
  }
}

async function runNaiveFixture(body, api, deadlineMs = 2000) {
  const src = `class Js extends JsProgram { async run() { ${body} } }`
  const handle = runNaive(api, deadlineMs, BASE, src)
  try {
    const json = await handle.programPromise
    if (typeof json === 'string' && json.includes('__jsProgramFailed')) {
      return { ok: false, json: JSON.parse(json) }
    }
    return { ok: true, value: JSON.parse(json) }
  } catch (e) {
    return { ok: false, err: String(e && e.message || e) }
  }
}

const reach = (expr) =>
  `const p = (${expr}); return { pid: typeof (p && p.pid), canFs: typeof (p && p.getBuiltinModule) };`

const api = {
  ls: async () => ['a.txt', 'sub/'],
  cat: async () => 'hello',
}

test('SPEC[sandbox-001] naive runner: returned array constructor reaches host process (base-red)', async () => {
  const result = await runNaiveFixture(
    `const r = await this.ls('.'); ${reach('r.constructor.constructor("return process")()')}`,
    api,
  )
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.pid, 'number')
  assert.equal(result.value.canFs, 'function')
})

test('SPEC[sandbox-001] membrane denies escape via returned array constructor', async () => {
  const result = await runMembrane(
    `const r = await this.ls('.'); ${reach('r.constructor.constructor("return process")()')}`,
    api,
  )
  assert.equal(result.ok, false)
  assert.match(String(result.json?.message || result.err || ''), /process is not defined/)
})

test('SPEC[sandbox-001] membrane denies escape via global api / globalThis / missing deadline ref', async () => {
  for (const body of [
    reach(`api.constructor.constructor('return process')()`),
    reach(`globalThis.constructor.constructor('return process')()`),
    reach(`__deadlineRef.constructor.constructor('return process')()`),
  ]) {
    const result = await runMembrane(body, api)
    assert.equal(result.ok, false, body)
  }
})

test('SPEC[sandbox-001] membrane cannot write outside the workspace via escape', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wxl-sandbox-'))
  const outside = join(dir, '..', 'wxl-sandbox-escaped-' + process.pid)
  try {
    const result = await runMembrane(
      `const r = await this.ls('.');
       const p = r.constructor.constructor('return process')();
       if (p && p.getBuiltinModule) p.getBuiltinModule('fs').writeFileSync(${JSON.stringify(outside)}, 'x');
       return { wrote: !!(p && p.getBuiltinModule) };`,
      api,
    )
    assert.equal(result.ok, false)
    assert.equal(existsSync(outside), false)
  } finally {
    rmSync(outside, { force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SPEC[sandbox-001] membrane still returns normal ls data', async () => {
  const result = await runMembrane(`return { entries: await this.ls('.') };`, api)
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.entries, ['a.txt', 'sub/'])
})
