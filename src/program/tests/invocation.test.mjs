import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ProgramInvocation, ProgramSession } from 'wanxiangli/program'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const emptyEffects = { rewritten: [], created: [], removed: [], moved: [] }

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'program-invocation-'))
  const session = ProgramSession(randomUUID())
  t.after(async () => { await session.close(); await rm(root, { recursive: true, force: true }) })
  const options = (name, body) => ({
    name, program: `class Js extends JsProgram { async run() { ${body} } }`,
    intent: 'Keep this invocation and its actual file results until the current operation finishes.',
    baseClass: 'class JsProgram { constructor(api) { Object.assign(this, api); } }',
    root, capabilities: ['Read', 'Write'], executionBudgetMs: 2000, outputBoundBytes: 16384,
  })
  const invocation = extra => new ProgramInvocation({
    root, ledger: { prepared: () => null, committed: () => {}, settle: async () => null },
    checkReturn: () => null, ...extra,
  })
  const execute = (owner, name, body) => owner.execute(session, options(name, body), owner.files)
  return { root, session, invocation, execute }
}

test('ProgramInvocation records actual effects in category order and keeps the first explicit read', { timeout: 15000 }, async t => {
  const h = await setup(t)
  for (const name of ['rewrite', 'remove', 'move']) await writeFile(join(h.root, name), name)
  const phases = []
  const tokens = []
  let observation
  const invocation = h.invocation({
    ledger: {
      prepared: ({ root, mutation }) => {
        assert.equal(root, h.root)
        const token = { mutation }
        tokens.push(token)
        phases.push(`prepared:${mutation.kind}`)
        return token
      },
      committed: token => {
        assert.strictEqual(token, tokens.at(-1))
        phases.push(`committed:${token.mutation.kind}`)
      },
      settle: async () => { phases.push('settle'); return null },
    },
    observe: async input => { observation = input; phases.push('observe'); throw new Error('ignored observation failure') },
    checkReturn: ({ value, outputBoundBytes }) => {
      phases.push('check')
      assert.deepEqual(value, { finished: true })
      assert.equal(outputBoundBytes, 16384)
      return null
    },
  })
  const result = await h.execute(invocation, 'files', `
    await this.cat('rewrite');
    await this.write('created', 'new');
    await this.write('rewrite', 'first');
    await this.cat('rewrite');
    await this.rm('remove');
    await this.mv('move', 'moved');
    await this.write('rewrite', 'second');
    await this.mkdir('directory');
    return {finished:true};`)
  assert.equal(result.receipt.state, 'completed', JSON.stringify(result))
  assert.equal(result.settlementFailure, null)
  assert.deepEqual(result.receipt.effects, { rewritten: ['rewrite', 'rewrite'], created: ['created'], removed: ['remove'], moved: [{ from: 'move', destination: 'moved' }] })
  assert.deepEqual(observation.effectPaths, ['rewrite', 'rewrite', 'created', 'remove', 'move', 'moved'])
  assert.deepEqual(observation.reads, [{ path: await realpath(join(h.root, 'rewrite')), resultBytes: 'rewrite' }])
  assert.deepEqual(phases, [
    'prepared:create', 'committed:create', 'prepared:rewrite', 'committed:rewrite',
    'prepared:remove', 'committed:remove', 'prepared:move', 'committed:move',
    'prepared:rewrite', 'committed:rewrite', 'observe', 'settle', 'check',
  ])
  assert.equal(await readFile(join(h.root, 'rewrite'), 'utf8'), 'second')
})

test('ProgramInvocation awaits the ledger and preserves its opaque failure alongside landed effects', { timeout: 15000 }, async t => {
  const h = await setup(t)
  const entered = deferred()
  const release = deferred()
  const original = { cause: new Error('store failed') }
  original.self = original
  const failure = { code: 'PERSISTENCE_FAILED', reason: 'store failed', failure: original }
  let checked = false
  const invocation = h.invocation({
    ledger: {
      prepared: () => original,
      committed: token => assert.strictEqual(token, original),
      settle: async () => { entered.resolve(); await release.promise; return failure },
    },
    checkReturn: () => { checked = true; return null },
  })
  const pending = h.execute(invocation, 'ledger', "await this.write('landed', 'saved'); return {done:true};")
  try {
    await entered.promise
    assert.equal(h.session.inspect().find(item => item.name === 'ledger').state, 'settling')
    assert.equal(await readFile(join(h.root, 'landed'), 'utf8'), 'saved')
    release.resolve()
    const result = await pending
    assert.equal(result.receipt.state, 'failed')
    assert.equal(result.receipt.code, 'PERSISTENCE_FAILED')
    assert.deepEqual(result.receipt.effects.created, ['landed'])
    assert.strictEqual(result.settlementFailure, failure)
    assert.strictEqual(result.settlementFailure.failure, original)
    assert.equal(checked, false)
    assert.doesNotThrow(() => JSON.stringify(result.receipt))
  } finally { release.resolve() }
})

test('ProgramInvocation keeps return-validation failures and only checks completed receipts', { timeout: 15000 }, async t => {
  const h = await setup(t)
  const original = { kind: 'invalid-value' }
  const failure = { code: 'INVALID_RETURN_VALUE', reason: 'invalid value', failure: original }
  const invocation = h.invocation({ checkReturn: () => failure })
  const rejected = await h.execute(invocation, 'invalid', "await this.write('invalid-effect', 'kept'); return [null];")
  assert.equal(rejected.receipt.state, 'failed')
  assert.strictEqual(rejected.settlementFailure.failure, original)
  assert.deepEqual(rejected.receipt.effects.created, ['invalid-effect'])
  const throwing = h.invocation({ checkReturn: () => assert.fail('failed program must not check a returned value') })
  const failed = await h.execute(throwing, 'throwing', "await this.write('throw-effect', 'kept'); throw new Error('program failed');")
  assert.equal(failed.receipt.state, 'failed')
  assert.deepEqual(failed.receipt.effects.created, ['throw-effect'])
  assert.equal(failed.settlementFailure, null)
})

test('ProgramInvocation return-check exceptions follow Run settlement failure without inventing effects', { timeout: 15000 }, async t => {
  const h = await setup(t)
  let settled = false
  const invocation = h.invocation({
    ledger: { prepared: () => null, committed: () => {}, settle: async () => { settled = true; return null } },
    checkReturn: () => { JSON.stringify({ toJSON() { throw new Error('return JSON failed') } }); return null },
  })
  const result = await h.execute(invocation, 'json', "await this.write('json-effect', 'kept'); return 1;")
  assert.equal(settled, true)
  assert.equal(result.receipt.state, 'failed')
  assert.match(result.receipt.reason, /return JSON failed/)
  assert.equal(result.receipt.effects, undefined)
  assert.equal(result.settlementFailure, null)
  assert.equal(await readFile(join(h.root, 'json-effect'), 'utf8'), 'kept')
})

test('ProgramInvocation retains target files and settlement across park without giving effects to its controller', { timeout: 15000 }, async t => {
  const h = await setup(t)
  const seen = []
  let settled = 0
  const target = h.invocation({
    ledger: { prepared: () => null, committed: () => {}, settle: async () => { settled++; return null } },
    observe: input => { seen.push(input) },
  })
  const parked = await h.execute(target, 'target', "await this.write('before', 'one'); const value=this.park('hold'); await this.write('after', value); return value;")
  assert.equal(parked.receipt.state, 'parked')
  assert.equal(parked.receipt.effects, undefined)
  assert.equal(settled, 0)
  assert.equal(seen.length, 0)
  const controller = h.invocation()
  const resumed = await h.execute(controller, 'controller', "return this.unpark('target', 'two');")
  assert.equal(resumed.receipt.state, 'completed')
  assert.deepEqual(resumed.receipt.effects, emptyEffects)
  assert.equal(resumed.receipt.value.state, 'completed')
  assert.deepEqual(resumed.receipt.value.effects.created, ['before', 'after'])
  assert.equal(settled, 1)
  assert.deepEqual(seen[0].effectPaths, ['before', 'after'])
  assert.equal(await readFile(join(h.root, 'after'), 'utf8'), 'two')
})

test('ProgramInvocation retains file access until session-close finally has settled', { timeout: 15000 }, async t => {
  const h = await setup(t)
  let settled = 0
  const invocation = h.invocation({
    ledger: { prepared: () => null, committed: () => {}, settle: async () => { settled++; return null } },
  })
  const parked = await h.execute(invocation, 'cleanup', "try { this.park('hold'); } finally { await this.write('cleanup', 'saved'); }")
  assert.equal(parked.receipt.state, 'parked')
  const closed = await h.session.close()
  assert.equal(closed.state, 'closed')
  assert.deepEqual(closed.programs[0].effects.created, ['cleanup'])
  assert.equal(await readFile(join(h.root, 'cleanup'), 'utf8'), 'saved')
  assert.equal(settled, 1)
})
