import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProgramSession, ProgramCatalog, Program, Wait } from 'wanxiangli/program'
import { Runtime, FileSession, RuntimeTools, Filesystem, ProcessSession, Terminal, OutputSpool, Time } from 'wanxiangli/runtime'
for (const member of [ProgramSession, ProgramCatalog, Program, Runtime, FileSession, RuntimeTools, Filesystem, ProcessSession, Terminal, OutputSpool]) assert.equal(typeof member, 'function')
assert.equal(typeof Wait, 'object')
assert.equal(typeof Time, 'object')
for (const old of ['programming', 'sandbox', 'wait', 'fs', 'process', 'pty', 'spool', 'time']) {
  await assert.rejects(import('wanxiangli/' + old), e => e.code === (process.versions.bun ? 'ERR_MODULE_NOT_FOUND' : 'ERR_PACKAGE_PATH_NOT_EXPORTED'))
}
const root = mkdtempSync(join(tmpdir(), 'installed-program-'))
const session = ProgramSession('clean-consumer-' + process.pid)
const options = (name, body, planB = 'Finish this operation within the single admitted request window.') => ({
  name, program: 'class Js extends JsProgram { async run() {' + body + '} }', planB,
  root, baseClass: 'class JsProgram { constructor(api) { Object.assign(this, api); } }',
  api: {}, capabilities: ['Exec'], executionBudgetMs: 1000, outputBoundBytes: 4096
})
try {
  const invalid = await session.execute({ ...options('missing', 'return 1;'), planB: '' })
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
} finally {
  assert.equal((await session.close()).state, 'closed')
  rmSync(root, { recursive: true, force: true })
}
console.log(JSON.stringify({installed:true, runtime: process.versions.bun ? 'bun':'node', named:true, controls:true, rawOutput:true, retiredEntries:true}))
