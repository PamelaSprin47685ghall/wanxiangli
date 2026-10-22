import test from 'node:test'
import assert from 'node:assert/strict'
import { Sandbox } from './support.mjs'

// SPEC[sandbox-005]: the production sandbox surface carries no pre-membrane
// runner, and the run handle exposes no mutable deadline: the deadline
// reference belongs to the sandbox object, which re-arms it by handle.

const law = Sandbox()
const BASE = `class JsProgram {
  constructor(api) { this._api = api; }
  async wait() { return await this._api.wait(); }
}`

test('SPEC[sandbox-005] the sandbox object exposes no naive runner and no deadline reset', () => {
  assert.equal(typeof law.run, 'function')
  assert.equal(typeof law.extendDeadline, 'function')
  assert.equal(law.runNaive, undefined)
  assert.equal(law.resetDeadline, undefined)
})

test('SPEC[sandbox-005] the run handle exposes the program promise and no deadline ref', () => {
  const handle = law.run({ wait: () => new Promise(() => {}) }, 2000, Date.now() + 60_000, BASE,
    'class Js extends JsProgram { async run() { await this.wait(); return 1; } }')
  assert.equal(typeof handle.programPromise.then, 'function')
  assert.equal(handle.deadlineRef, undefined)
  assert.deepEqual(Object.keys(handle), ['programPromise'])
})

test('SPEC[sandbox-005] extendDeadline re-arms the async deadline of a run', async () => {
  const handle = law.run({ wait: () => new Promise((r) => setTimeout(() => r('late'), 150)) },
    2000, Date.now() + 50, BASE,
    'class Js extends JsProgram { async run() { await this.wait(); return 1; } }')
  law.extendDeadline(handle, Date.now() + 60_000)
  assert.equal(JSON.parse(await handle.programPromise), 1)
})

test('SPEC[sandbox-005] an unextended deadline still bounds the run', async () => {
  const handle = law.run({ wait: () => new Promise((r) => setTimeout(() => r('late'), 150)) },
    2000, Date.now() + 50, BASE,
    'class Js extends JsProgram { async run() { await this.wait(); return 1; } }')
  await assert.rejects(() => handle.programPromise, (e) => e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT')
})

test('SPEC[sandbox-005] extendDeadline rejects a handle this sandbox did not start', () => {
  assert.throws(() => law.extendDeadline({ programPromise: Promise.resolve('') }, Date.now() + 60_000))
})
