import test from 'node:test'
import assert from 'node:assert/strict'
import { ProgramCallers, programCallers, Program } from './support.mjs'

test('SPEC[program-callers-1] noteCaller records caller and callerName returns recorded name', () => {
  const callers = new ProgramCallers()
  assert.equal(callers.callerName('sess-1', 'call-1'), undefined)
  callers.noteCaller('sess-1', 'call-1', 'prog-alpha')
  assert.equal(callers.callerName('sess-1', 'call-1'), 'prog-alpha')
  assert.equal(callers.count, 1)
})

test('SPEC[program-callers-2] empty or whitespace sessionId / callId / name are rejected without polluting state', () => {
  const callers = new ProgramCallers()
  callers.noteCaller('', 'call-1', 'prog-1')
  callers.noteCaller('sess-1', '', 'prog-1')
  callers.noteCaller('sess-1', 'call-1', '')
  assert.equal(callers.count, 0)
  assert.equal(callers.callerName('', 'call-1'), undefined)
  assert.equal(callers.callerName('sess-1', ''), undefined)
  assert.equal(callers.callerName('', ''), undefined)
})

test('SPEC[program-callers-3] clearCaller removes targeted callId while retaining other calls in same session', () => {
  const callers = new ProgramCallers()
  callers.noteCaller('sess-1', 'call-a', 'prog-a')
  callers.noteCaller('sess-1', 'call-b', 'prog-b')
  assert.equal(callers.count, 2)
  callers.clearCaller('sess-1', 'call-a')
  assert.equal(callers.callerName('sess-1', 'call-a'), undefined)
  assert.equal(callers.callerName('sess-1', 'call-b'), 'prog-b')
  assert.equal(callers.count, 1)

  // Clearing non-existent or empty callId is safe no-op
  callers.clearCaller('sess-1', 'non-existent')
  callers.clearCaller('', 'call-b')
  callers.clearCaller('sess-1', '')
  assert.equal(callers.callerName('sess-1', 'call-b'), 'prog-b')
  assert.equal(callers.count, 1)
})

test('SPEC[program-callers-4] clearSession removes all calls for session and strictly isolates prefix-similar sessions', () => {
  const callers = new ProgramCallers()
  callers.noteCaller('s1', 'c1', 'prog-1')
  callers.noteCaller('s1', 'c2', 'prog-2')
  callers.noteCaller('s10', 'c1', 'prog-10')
  callers.noteCaller('s100', 'c1', 'prog-100')
  callers.noteCaller('other', 'c1', 'prog-other')
  assert.equal(callers.count, 5)

  // Clear s1: s10, s100 and other must remain untouched
  callers.clearSession('s1')
  assert.equal(callers.callerName('s1', 'c1'), undefined)
  assert.equal(callers.callerName('s1', 'c2'), undefined)
  assert.equal(callers.callerName('s10', 'c1'), 'prog-10')
  assert.equal(callers.callerName('s100', 'c1'), 'prog-100')
  assert.equal(callers.callerName('other', 'c1'), 'prog-other')
  assert.equal(callers.count, 3)

  // Empty sessionId is safe no-op
  callers.clearSession('')
  assert.equal(callers.count, 3)

  // clearAll cleans everything
  callers.clearAll()
  assert.equal(callers.count, 0)
  assert.equal(callers.callerName('s10', 'c1'), undefined)
})

test('SPEC[program-callers-5] independent instances and global singleton do not cross-pollute', () => {
  const instanceA = new ProgramCallers()
  const instanceB = new ProgramCallers()

  instanceA.noteCaller('sess-iso', 'call-1', 'prog-a')
  assert.equal(instanceA.callerName('sess-iso', 'call-1'), 'prog-a')
  assert.equal(instanceB.callerName('sess-iso', 'call-1'), undefined)

  // Test global singleton programCallers
  programCallers.clearAll()
  assert.equal(programCallers.count, 0)
  programCallers.noteCaller('sess-global', 'call-g', 'prog-global')
  assert.equal(programCallers.callerName('sess-global', 'call-g'), 'prog-global')
  assert.equal(instanceA.callerName('sess-global', 'call-g'), undefined)
  programCallers.clearAll()
  assert.equal(programCallers.count, 0)
})

test('SPEC[program-callers-6] Program().close(sessionId) triggers caller cleanup on singleton', async () => {
  programCallers.clearAll()
  const p = Program()
  const sess = p.session('managed-close-sess')
  programCallers.noteCaller('managed-close-sess', 'call-x', 'prog-x')
  assert.equal(programCallers.callerName('managed-close-sess', 'call-x'), 'prog-x')

  await p.close('managed-close-sess')
  assert.equal(programCallers.callerName('managed-close-sess', 'call-x'), undefined)
  assert.equal(programCallers.count, 0)
})
