import test from 'node:test'
import assert from 'node:assert/strict'

import { ProviderFailureBudget } from 'wanxiangli/failure-budget'

const b = new ProviderFailureBudget()
const id = (providerRun, over = {}) => ({ sessionId: 's', logicalRun: 'lr', authorityRoot: 'root', providerRun, ...over })
const advance = (state, providerRun, over) => {
  const r = b.applyFailure(id(providerRun, over), state.consecutiveFailureCount + 1, state)
  assert.equal(r.ok, true, JSON.stringify(r))
  return r.state
}

test('SPEC[failure-budget-1] exact attempt key is the historical host key and dedupes a second observation', () => {
  assert.equal(b.dedupeKey(id('p1')), 's\u001flr\u001froot\u001fp1')
  const s0 = b.forAuthority('lr', 'root')
  assert.ok(Object.isFrozen(s0) && Object.isFrozen(s0.recentFailureKeys))
  const s1 = advance(s0, 'p1')
  assert.deepEqual({ ...s1, recentFailureKeys: [...s1.recentFailureKeys] }, {
    logicalRun: 'lr', authorityRoot: 'root', consecutiveFailureCount: 1, recentFailureKeys: [b.dedupeKey(id('p1'))],
    exhausted: false, lastTransitionWasSuccess: false })
  assert.deepEqual({ ...b.applyFailure(id('p1'), 2, s1) }, { ok: false, rejection: 'AlreadyObserved' })
  let s = s1
  for (let i = 2; i <= 40; i++) s = advance(s, `p${i}`)
  assert.equal(s.recentFailureKeys.length, b.dedupeWindow)
  assert.equal(s.recentFailureKeys[0], b.dedupeKey(id('p40')))
  assert.equal(b.applyFailure(id('p1'), 41, s).ok, true, 'a key older than the window is no longer remembered')
})

test('SPEC[failure-budget-2] single-step advance, other run, exhaustion is terminal, success clears', () => {
  const s1 = advance(b.forAuthority('lr', 'root'), 'p1')
  assert.equal(b.applyFailure(id('p2'), 3, s1).rejection, 'InvalidTransition')
  assert.equal(b.applyFailure(id('p2'), 1, s1).rejection, 'InvalidTransition')
  assert.equal(b.applyFailure(id('p2', { logicalRun: 'other' }), 2, s1).rejection, 'DifferentRun')
  assert.equal(b.applyFailure(id('p2', { authorityRoot: 'other' }), 2, s1).rejection, 'DifferentRun')
  const ex = b.applyExhausted(s1)
  assert.equal(b.applyFailure(id('p1'), 2, ex).rejection, 'AlreadyExhausted', 'exhausted wins over dedupe')
  assert.equal(b.mayRetry(12, ex), false)
  const ok = b.recordSuccess(s1)
  assert.equal(ok.consecutiveFailureCount, 0)
  assert.equal(ok.recentFailureKeys.length, 0)
  assert.equal(ok.lastTransitionWasSuccess, true)
  assert.equal(advance(ok, 'p1').lastTransitionWasSuccess, false)
  assert.equal(b.verdict(12, 11), 'MayRetry')
  assert.equal(b.verdict(12, 12), 'Exhausted')
  let s = b.forAuthority('lr', 'root')
  for (let i = 1; i < 10; i++) s = advance(s, `p${i}`)
  assert.equal(b.mayRetry(b.defaultBudget, s), true)
  s = advance(s, 'p10')
  assert.equal(b.mayRetry(b.defaultBudget, s), false)
})

test('SPEC[failure-budget-3] a replayed failure is answered from the record; only the latest attempt may retry', () => {
  let s = advance(advance(b.forAuthority('lr', 'root'), 'p1'), 'p2')
  assert.equal(b.replay(12, id('p2'), s), 'RetryAuthorized')
  assert.equal(b.replay(12, id('p1'), s), 'EpisodeSuperseded')
  assert.equal(b.replay(2, id('p2'), s), 'RetryExhausted')
  assert.equal(b.replay(12, id('p2'), b.applyExhausted(s)), 'RetryExhausted')
  assert.equal(b.replay(12, id('p9'), s), 'EpisodeSuperseded')
})

test('SPEC[failure-budget-4] malformed input is rejected, never guessed', () => {
  const s = b.forAuthority('lr', 'root')
  assert.throws(() => b.forAuthority(undefined, 'root'), /logicalRun/)
  assert.throws(() => b.applyFailure(id(7), 1, s), /providerRun/)
  assert.equal(b.applyFailure(id(''), 1, s).ok, true, 'an empty identity is still opaque text')
  assert.throws(() => b.applyFailure(id('p'), -1, s), /consecutiveFailureCount/)
  assert.throws(() => b.applyFailure(id('p'), 1.5, s), /consecutiveFailureCount/)
  assert.throws(() => b.applyFailure(id('p'), 1, { ...s, exhausted: 'no' }), /exhausted/)
  assert.throws(() => b.applyFailure(id('p'), 1, { ...s, recentFailureKeys: [3] }), /recentFailureKeys/)
  assert.throws(() => b.mayRetry(-1, s), /budgetLimit/)
  assert.throws(() => b.applyFailure(null, 1, s), /identity/)
})
