import test from 'node:test'
import assert from 'node:assert/strict'

import { Dispatch } from 'wanxiangli/dispatch'

const law = new Dispatch()

test('SPEC[dispatch-7] a run boundary keeps only session-scoped root claims and this session\'s root counters', () => {
  const claims = [
    { key: 'root-pending', logicalRunId: null },
    { key: 'cont', logicalRunId: 'run-1' },
    { key: 'root-undefined' },
    { key: 'blank-run', logicalRunId: '' },
    { key: 'cont-2', logicalRunId: 'run-2' },
  ]
  const counters = [
    { scope: 'a', sessionId: 's1', logicalRunId: null },
    { scope: 'b', sessionId: 's1', logicalRunId: 'run-1' },
    { scope: 'c', sessionId: 's2', logicalRunId: null },
    { scope: 'd', sessionId: 's1' },
    { scope: 'e', sessionId: 's1', logicalRunId: '' },
  ]
  // Independent oracle from dispatch-protocol [006] and the CUT-09 §6 hand-over.
  const keepClaims = claims.filter((c) => c.logicalRunId === null || c.logicalRunId === undefined).map((c) => c.key)
  const keepCounters = counters.filter((c) => c.sessionId === 's1' && (c.logicalRunId === null || c.logicalRunId === undefined)).map((c) => c.scope)
  const verdict = law.reset({ sessionId: 's1', claims, counters })
  assert.deepEqual({ ...verdict, keepClaims: [...verdict.keepClaims], keepCounters: [...verdict.keepCounters] },
    { keepClaims, keepCounters, clearContinuations: true, clearQuestions: true })
  assert.deepEqual(keepClaims, ['root-pending', 'root-undefined'])
  assert.deepEqual(keepCounters, ['a', 'd'])
  assert.ok(Object.isFrozen(verdict) && Object.isFrozen(verdict.keepClaims) && Object.isFrozen(verdict.keepCounters))
  assert.deepEqual([...law.reset({ sessionId: 's1', claims: [], counters: [] }).keepClaims], [])
  assert.throws(() => law.reset({ sessionId: 's1', claims: {}, counters: [] }), /malformed claims/)
  assert.throws(() => law.reset({ sessionId: 's1', claims: [{ key: 1 }], counters: [] }), /malformed claim.key/)
  assert.throws(() => law.reset({ sessionId: 's1', claims: [], counters: [{ scope: 'x' }] }), /malformed counter.sessionId/)
})
