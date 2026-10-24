import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Runtime } from '../../../dist/runtime/Runtime.js'

const baseClass = `class JsProgram {
  constructor(api) { this._api = api; }
  async echo(value) { return await this._api.echo(value); }
  async call(command) { return await this._api.call(command); }
  write(value) { return this._api.write(value); }
}`
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function fixture(t) {
  const space = mkdtempSync(join(tmpdir(), 'runtime-isolation-'))
  const root = join(space, 'project'), sentinel = join(space, 'ambient-escape.txt'), units = []
  mkdirSync(root)
  t.after(async () => { await Promise.all(units.map(unit => unit.stop('test cleanup'))); rmSync(space, { recursive: true, force: true }) })
  function start(program, receive = (request, reply) => reply({ ok: true, value: request.args[0] })) {
    let unit, finish
    const terminal = new Promise(resolve => { finish = resolve })
    unit = Runtime().startUnit({ root, program, baseClass, members: ['echo','call','write'], executionBudgetMs: 1000 }, message => {
      if (message.type === 'completed' || message.type === 'failed') finish(message)
      else if (message.type === 'request') receive(message, envelope => unit.reply(message.id, envelope))
    })
    units.push(unit)
    return { unit, terminal }
  }
  return { sentinel, start }
}
function probe(sentinel) {
  return `const escaped = [];
    function inspect(label, obtain) {
      try {
        const foreign = obtain();
        if (foreign && foreign.versions && foreign.pid) {
          escaped.push(label);
          if (typeof foreign.getBuiltinModule === 'function')
            foreign.getBuiltinModule('node:fs').writeFileSync(${JSON.stringify(sentinel)}, label);
        }
      } catch (_) {}
    }`
}
test('Runtime: arrays, VM globals and API values do not expose a host constructor', { timeout: 5000 }, async t => {
  const { sentinel, start } = fixture(t)
  const run = start(`class Js extends JsProgram { async run() {
    ${probe(sentinel)}
    const values = await this.echo([[1,2],3]);
    inspect('array', () => values.constructor.constructor('return process')());
    inspect('nested', () => values[0].constructor.constructor('return process')());
    inspect('global', () => globalThis.constructor.constructor('return process')());
    inspect('api', () => this._api.constructor.constructor('return process')());
    try { const foreign = await (async function(){}).constructor('return process')(); inspect('async-function', () => foreign); } catch (_) {}
    inspect('generator', () => (function*(){}).constructor('yield process')().next().value);
    return { escaped, apiConstructor: typeof this._api.constructor, processType: typeof process, requireType: typeof require };
  } }`)
  const result = await run.terminal
  assert.equal(result.type, 'completed', JSON.stringify(result))
  assert.deepEqual(result.value, { escaped: [], apiConstructor: 'undefined', processType: 'undefined', requireType: 'undefined' })
  assert.equal(existsSync(sentinel), false)
  await run.unit.exited
})
test('Runtime: WeakMap intrinsic hooks cannot obtain host values', { timeout: 5000 }, async t => {
  const { sentinel, start } = fixture(t)
  const run = start(`class Js extends JsProgram { async run() {
    ${probe(sentinel)}
    const captured = [];
    for (const name of ['has','set']) {
      const original = WeakMap.prototype[name];
      WeakMap.prototype[name] = function(...args) { captured.push(this,...args); return Reflect.apply(original,this,args); };
    }
    const own = new WeakMap(), key = {}; own.set(key,{}); own.has(key);
    const data = await this.echo({ values:[1,2] }); captured.push(data,data.values);
    for (const value of captured) inspect('weak-map', () => value.constructor.constructor('return process')());
    return { escaped, hooksRan: captured.length > 2 };
  } }`)
  const result = await run.terminal
  assert.equal(result.type, 'completed', JSON.stringify(result))
  assert.deepEqual(result.value, { escaped: [], hooksRan: true })
  assert.equal(existsSync(sentinel), false)
  await run.unit.exited
})
test('Runtime: SDK errors belong to the VM realm', { timeout: 5000 }, async t => {
  const { sentinel, start } = fixture(t)
  const run = start(`class Js extends JsProgram { async run() {
    ${probe(sentinel)}
    let code;
    try { await this.echo('fail'); } catch(error) {
      code = error.code; inspect('sdk-error', () => error.constructor.constructor('return process')());
    }
    return { escaped, code };
  } }`, (_, reply) => reply({ ok: false, code: 'TEST_SDK_FAILURE', reason: 'test failure' }))
  const result = await run.terminal
  assert.equal(result.type, 'completed', JSON.stringify(result))
  assert.deepEqual(result.value, { escaped: [], code: 'TEST_SDK_FAILURE' })
  assert.equal(existsSync(sentinel), false)
  await run.unit.exited
})
test('Runtime: an earlier SDK reply cannot execute a then getter inside blocked call', { timeout: 5000 }, async t => {
  const { start } = fixture(t), writes = []
  let releaseCall, announceCall
  const callObserved = new Promise(resolve => { announceCall = resolve })
  const run = start(`class Js extends JsProgram { async run() {
    const api = this._api; let armed = true;
    Object.defineProperty(Object.prototype,'then',{ configurable:true, get() {
      if (armed && this.marker === 'sdk-payload') { armed = false; api.write('then getter ran'); }
      return undefined;
    } });
    const earlier = this.echo('earlier');
    await this.call('held command');
    const result = await earlier;
    delete Object.prototype.then;
    return result.marker;
  } }`, (request, reply) => {
    if (request.member === 'echo') reply({ ok: true, value: { marker: 'sdk-payload' } })
    else if (request.member === 'call') {
      releaseCall = () => reply({ ok: true, value: { exitCode: 0, signal: null } })
      announceCall()
    } else if (request.member === 'write') { writes.push(request.args[0]); reply({ ok: true, value: true }) }
  })
  await callObserved
  await delay(80)
  assert.deepEqual(writes, [], 'VM code must stay blocked until call returns')
  releaseCall()
  const result = await run.terminal
  assert.equal(result.type, 'completed', JSON.stringify(result))
  assert.equal(result.value, 'sdk-payload')
  assert.deepEqual(writes, ['then getter ran'])
  await run.unit.exited
})
