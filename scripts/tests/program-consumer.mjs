import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProgramSession, ProgramCatalog, Program, ProgramInvocation, Wait } from 'wanxiangli/program'
import { Runtime, FileSession, RuntimeTools, Filesystem, ProcessSession, Terminal, OutputSpool, Time } from 'wanxiangli/runtime'
for (const member of [ProgramSession, ProgramCatalog, Program, Runtime, FileSession, RuntimeTools, Filesystem, ProcessSession, Terminal, OutputSpool]) assert.equal(typeof member, 'function')
assert.equal(typeof Wait, 'object')
assert.equal(typeof Time, 'object')
for (const old of ['programming', 'sandbox', 'wait', 'fs', 'process', 'pty', 'spool', 'time']) {
  await assert.rejects(import('wanxiangli/' + old), e => e.code === (process.versions.bun ? 'ERR_MODULE_NOT_FOUND' : 'ERR_PACKAGE_PATH_NOT_EXPORTED'))
}
const root = mkdtempSync(join(tmpdir(), 'installed-program-'))
const session = ProgramSession('clean-consumer-' + process.pid)
const options = (name, body, intent = 'Finish this operation within the single admitted request window.') => ({
  name, program: 'class Js extends JsProgram { async run() {' + body + '} }', intent,
  root, baseClass: 'class JsProgram { constructor(api) { Object.assign(this, api); } }',
  api: {}, capabilities: ['Exec'], executionBudgetMs: 1000, outputBoundBytes: 4096
})
try {
  const invalid = await session.execute({ ...options('missing', 'return 1;'), intent: '' })
  assert.equal(invalid.code, 'INVALID_ARGUMENT')
  const first = await session.execute(options('named', "const v=this.park('question'); return {answer:v};"))
  assert.equal(first.state, 'parked')
  const resumed = await session.execute(options('resume', "return this.unpark('named', 42);"))
  assert.equal(resumed.state, 'completed')
  assert.equal(resumed.value.state, 'completed')
  assert.deepEqual(resumed.value.value, {answer:42})
  const cmd = await session.execute(options('command', "return this.call(\"printf 'installed stdout'; printf 'installed stderr' >&2; exit 7\");"))
  assert.equal(cmd.state, 'completed')
  assert.equal(cmd.value.exitCode, 7)
  assert.equal(cmd.value.stdout, 'installed stdout')
  assert.equal(cmd.value.stderr, 'installed stderr')
  assert.equal(readFileSync(cmd.value.outputFiles.stdout, 'utf8'), 'installed stdout')
  const attack = await session.execute(options('attack', "return this.call('touch bypass', 'x'.repeat(48000));"))
  assert.equal(attack.state, 'failed')
  assert.equal(existsSync(join(root, 'bypass')), false)
  const tokens = []
  const observed = []
  let settled = 0
  const invocation = new ProgramInvocation({
    root,
    ledger: {
      prepared: ({ mutation }) => { const token = { mutation }; tokens.push(token); return token },
      committed: token => assert.strictEqual(token, tokens.at(-1)),
      settle: async () => { settled++; return null },
    },
    observe: value => { observed.push(value) },
    checkReturn: () => null,
  })
  const { api: unusedApi, ...invocationOptions } = options('file-invocation', "await this.write('first-file', 'before'); const answer=this.park('hold'); await this.write('second-file', answer); return answer;")
  const paused = await invocation.execute(session, { ...invocationOptions, capabilities: ['Read', 'Write'] }, invocation.files)
  assert.equal(paused.receipt.state, 'parked')
  assert.equal(settled, 0)
  const continued = await session.execute({ ...options('file-controller', "return this.unpark('file-invocation', 'after');"), capabilities: ['Read', 'Write'] })
  assert.equal(continued.state, 'completed')
  assert.equal(continued.value.state, 'completed')
  assert.deepEqual(continued.value.effects.created, ['first-file', 'second-file'])
  assert.equal(settled, 1)
  assert.deepEqual(observed[0].effectPaths, ['first-file', 'second-file'])
  assert.equal(readFileSync(join(root, 'second-file'), 'utf8'), 'after')
} finally {
  assert.equal((await session.close()).state, 'closed')
  rmSync(root, { recursive: true, force: true })
}
console.log(JSON.stringify({installed:true, runtime: process.versions.bun ? 'bun':'node', named:true, controls:true, rawOutput:true, retiredEntries:true}))
