import test from 'node:test'
import assert from 'node:assert/strict'
import { Sandbox } from './support.mjs'

// SPEC[sandbox-003]: the membrane shares its realm with the model program, so a
// model that monkeypatches a built-in method the membrane relies on must not be
// able to observe the raw host values the membrane feeds those methods. The
// confirmed route was WeakMap.prototype.has/.set: wrap()/unwrap() pass the real
// host object to the map, so a patched method receives it and can reach the host
// process through constructor.constructor. The membrane must call these methods
// through references captured before any model code runs.
// Base-red: these cases report leaked=true on the 0.23.1 membrane (library
// d2a9f3b); see host evidence/CUT-25/membrane-0.23.1-red-intrinsics.json.

const law = Sandbox()
const BASE = `class JsProgram {
  constructor(api) { this._api = api; }
  async ls(path) { return await this._api.ls(path); }
  async cat(path) { return await this._api.cat(path); }
}`
const api = { ls: async () => ['a.txt', 'sub/'], cat: async () => 'hello' }

async function runMembrane(body, deadlineMs = 2000) {
  const src = `class Js extends JsProgram { async run() { ${body} } }`
  const handle = law.run(api, deadlineMs, Date.now() + 60_000, BASE, src)
  try {
    const json = await handle.programPromise
    if (typeof json === 'string' && json.includes('__jsProgramFailed')) return { ok: false, json: JSON.parse(json) }
    return { ok: true, value: JSON.parse(json) }
  } catch (e) { return { ok: false, err: String(e && e.message || e) } }
}

const PROC = `const isProc = (p) => !!(p && typeof p.pid === 'number' && typeof p.getBuiltinModule === 'function');`
const patchHas = `${PROC}
  let leaked = false;
  const original = WeakMap.prototype.has;
  WeakMap.prototype.has = function (key) {
    try { const p = key && key.constructor && key.constructor.constructor('return process')(); if (isProc(p)) leaked = true; } catch (_) {}
    return original.call(this, key);
  };
  try { await this.ls('.'); } finally { WeakMap.prototype.has = original; }
  return { leaked };`
const patchSet = `${PROC}
  let leaked = false;
  const original = WeakMap.prototype.set;
  WeakMap.prototype.set = function (key, value) {
    try { const p = key && key.constructor && key.constructor.constructor('return process')(); if (isProc(p)) leaked = true; } catch (_) {}
    return original.call(this, key, value);
  };
  try { await this.ls('.'); } finally { WeakMap.prototype.set = original; }
  return { leaked };`

test('SPEC[sandbox-003] membrane: patched WeakMap.prototype.has cannot observe a host value', async () => {
  const r = await runMembrane(patchHas)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.value.leaked, false)
})

test('SPEC[sandbox-003] membrane: patched WeakMap.prototype.set cannot observe a host value', async () => {
  const r = await runMembrane(patchSet)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.value.leaked, false)
})

test('SPEC[sandbox-003] membrane still returns normal ls data after intrinsic churn', async () => {
  const r = await runMembrane(`const o = WeakMap.prototype.has; WeakMap.prototype.has = o; return { entries: await this.ls('.') };`)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(r.value.entries, ['a.txt', 'sub/'])
})
