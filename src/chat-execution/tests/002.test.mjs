import test from 'node:test'
import assert from 'node:assert/strict'

import { ChatExecutionLaw } from 'wanxiangli/chat-execution'

const law = new ChatExecutionLaw()
const plain = (v) => JSON.parse(JSON.stringify(v))
const A = { phase: 'Accepted' }, S = { phase: 'ProviderStarted' }
const B = { phase: 'EndedBeforeStart', disposition: 'Failed' }, E = { phase: 'EndedAfterStart', disposition: 'Completed' }
const recover = (over) => plain(law.recover({
  current: A, provider: 'Absent', resource: 'Held', persistence: 'NotCommitted',
  providerKeySame: true, resourceKeySame: true, providerAcceptedSame: true, providerSameAsStarted: true,
  policy: null, ...over,
}))

test('SPEC[chat-execution-3] counterexample: evidence of another execution is ignored as stale before anything else', () => {
  for (const k of ['providerKeySame', 'resourceKeySame', 'providerAcceptedSame'])
    for (const current of [A, S, B, E])
      assert.deepEqual(recover({ current, [k]: false, persistence: 'Unknown', resource: 'Unknown' }), { decision: 'ignore', reason: 'StalePhysicalEvidence' })
})

test('SPEC[chat-execution-3] an ended execution only settles its physical resource; unknown goes to a human', () => {
  for (const current of [B, E]) {
    assert.deepEqual(recover({ current }), { decision: 'releaseTerminalResource' })
    assert.deepEqual(recover({ current, resource: 'Absent' }), { decision: 'ignore', reason: 'DurableTerminalAlreadySettled' })
    assert.deepEqual(recover({ current, resource: 'Released', persistence: 'Unknown' }), { decision: 'ignore', reason: 'DurableTerminalAlreadySettled' })
    assert.deepEqual(recover({ current, resource: 'Unknown' }), { decision: 'manual', reason: 'PhysicalOutcomeUnknown' })
  }
})

test('SPEC[chat-execution-3] counterexample: an unknown persistence outcome is never settled by guess', () => {
  for (const current of [A, S]) {
    assert.deepEqual(recover({ current, persistence: 'Unknown' }), { decision: 'manual', reason: 'PersistenceOutcomeUnknown' })
    assert.deepEqual(recover({ current, persistence: 'NoNewWrite' }), { decision: 'manual', reason: 'PersistenceOutcomeUnknown' })
    assert.deepEqual(recover({ current, persistence: 'Committed' }), { decision: 'ignore', reason: 'RecoveryAlreadyCommitted' })
  }
})

test('SPEC[chat-execution-3] accepted: resume before the provider, or record what the provider already did', () => {
  assert.deepEqual(recover({ provider: 'ReceiptMissing' }), { decision: 'manual', reason: 'MissingExternalReceipt' })
  assert.deepEqual(recover({ provider: 'ReceiptAmbiguous' }), { decision: 'manual', reason: 'AmbiguousExternalReceipt' })
  assert.deepEqual(recover({ provider: 'Absent' }), { decision: 'resumePreProvider' })
  assert.deepEqual(recover({ provider: 'Alive' }), { decision: 'persistProviderStarted' })
  assert.deepEqual(recover({ provider: 'Terminal' }), { decision: 'persistProviderStartedAndTerminal' })
})

test('SPEC[chat-execution-3] started: only the same run settles; an absent provider needs an exact policy authorization', () => {
  assert.deepEqual(recover({ current: S, provider: 'Alive' }), { decision: 'ignore', reason: 'ProviderStillAlive' })
  assert.deepEqual(recover({ current: S, provider: 'Terminal' }), { decision: 'finalize', from: 'observation' })
  assert.deepEqual(recover({ current: S, provider: 'Alive', providerSameAsStarted: false }), { decision: 'ignore', reason: 'StalePhysicalEvidence' })
  assert.deepEqual(recover({ current: S, provider: 'Terminal', providerSameAsStarted: false }), { decision: 'ignore', reason: 'StalePhysicalEvidence' })
  assert.deepEqual(recover({ current: S, provider: 'ReceiptMissing' }), { decision: 'manual', reason: 'MissingExternalReceipt' })
  assert.deepEqual(recover({ current: S }), { decision: 'manual', reason: 'NoAuthorizedProviderDisposition' })
  const policy = (resolution, matches) => recover({ current: S, policy: { resolution, matches } })
  assert.deepEqual(policy('RetryFreshAttempt', true), { decision: 'ignore', reason: 'ProviderRecoveryOwned' })
  assert.deepEqual(policy('TerminalizeProviderStarted', true), { decision: 'finalize', from: 'policy' })
  assert.deepEqual(policy('RetryFreshAttempt', false), { decision: 'ignore', reason: 'StalePolicyEvidence' })
  assert.deepEqual(policy('TerminalizeProviderStarted', false), { decision: 'ignore', reason: 'StalePolicyEvidence' })
  for (const r of ['PreserveCurrentFact', 'AwaitAcceptanceReconciliation', 'TerminalizeAcceptedPreProvider'])
    for (const m of [true, false]) assert.deepEqual(policy(r, m), { decision: 'manual', reason: 'NoAuthorizedProviderDisposition' })
})

test('SPEC[chat-execution-3] malformed recovery input is refused', () => {
  assert.throws(() => law.recover(null), /recovery/)
  assert.throws(() => recover({ current: null }), /recovery.current/)
  assert.throws(() => recover({ resource: 'Gone' }), /recovery.resource/)
  assert.throws(() => recover({ providerKeySame: 'yes' }), /providerKeySame/)
  assert.throws(() => recover({ current: S, policy: { resolution: 'Other', matches: true } }), /resolution/)
  assert.throws(() => recover({ persistence: 'Maybe' }), /persistence/)
})
