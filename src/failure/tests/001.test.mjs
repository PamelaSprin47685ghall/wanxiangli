import test from 'node:test'
import assert from 'node:assert/strict'

import { ExecutionFailurePolicy } from 'wanxiangli/failure'

const policy = new ExecutionFailurePolicy()
const key = { sessionId: 's', physicalUserMessageId: 'm' }
const fence = { reference: 'f-1' }
const provider = (over = {}) => ({ logicalRun: 'lr', providerRun: 'pr', requestKind: 'WorkMain', retryBudget: 'Available', breaker: 'Closed', ...over })
const decide = (failure, phase, over = {}) =>
  policy.decide({ failure, phase, executionKey: key, capacityFence: fence, provider: provider(), ...over })

test('SPEC[failure-1] pure, frozen, key and fence handed back by reference', () => {
  const d = decide('LocalInvariant', 'ProviderStarted')
  assert.ok(Object.isFrozen(d))
  assert.equal(d.executionKey, key)
  assert.equal(d.capacityFence, fence)
  assert.deepEqual({ ...d, executionKey: null, capacityFence: null }, {
    resolution: 'TerminalizeProviderStarted', executionKey: null, terminalDisposition: 'Failed', authorization: null,
    breaker: 'NoBreakerTransition', capacitySettlement: 'ReleaseExactFence', capacityFence: null, fatality: 'FatalAfterSettlement'
  })
  assert.deepEqual(decide('LocalInvariant', 'ProviderStarted'), d)
})

test('SPEC[failure-2] unknown is never failure: await reconciliation and keep the exact fence', () => {
  for (const failure of ['AcceptanceUnknown', { kind: 'PersistenceFailure', commitment: 'Unknown' }]) {
    for (const phase of ['NoAcceptedFact', 'AcceptedBeforeProvider', 'ProviderStarted', 'Terminal']) {
      const d = decide(failure, phase)
      assert.equal(d.resolution, 'AwaitAcceptanceReconciliation')
      assert.equal(d.executionKey, key)
      assert.equal(d.capacitySettlement, 'RetainExactFence')
      assert.equal(d.capacityFence, fence)
    }
  }
  for (const commitment of ['NotCommitted', 'NoNewWrite']) {
    const d = decide({ kind: 'PersistenceFailure', commitment }, 'ProviderStarted')
    assert.equal(d.resolution, 'PreserveCurrentFact')
    assert.equal(d.capacitySettlement, 'RetainExactFence')
  }
  assert.equal(decide({ kind: 'PersistenceFailure', commitment: 'Committed' }, 'ProviderStarted').capacitySettlement, 'ReleaseExactFence')
})

test('SPEC[failure-3] retry only after provider start, breaker closed and budget available', () => {
  const d = decide('ProviderTransient', 'ProviderStarted')
  assert.equal(d.resolution, 'RetryFreshAttempt')
  assert.equal(d.executionKey, null)
  assert.deepEqual({ ...d.authorization }, { decisionId: '2:lr|2:pr|8:WorkMain', logicalRun: 'lr', providerRun: 'pr', requestKind: 'WorkMain' })
  assert.equal(d.breaker, 'RecordProviderTransientFailure')
  for (const over of [{ breaker: 'Open' }, { retryBudget: 'Exhausted' }]) {
    const t = decide('ProviderPermanent', 'ProviderStarted', { provider: provider(over) })
    assert.equal(t.resolution, 'TerminalizeProviderStarted')
    assert.equal(t.terminalDisposition, 'Failed')
    assert.equal(t.breaker, 'RecordProviderPermanentFailure')
  }
  assert.equal(decide('ProviderTransient', 'AcceptedBeforeProvider').resolution, 'TerminalizeAcceptedPreProvider')
  assert.equal(decide('ProviderTransient', 'Terminal').resolution, 'PreserveCurrentFact')
  assert.notEqual(
    decide('ProviderTransient', 'ProviderStarted', { provider: provider({ logicalRun: 'a|1:b', providerRun: 'c' }) }).authorization.decisionId,
    decide('ProviderTransient', 'ProviderStarted', { provider: provider({ logicalRun: 'a', providerRun: 'b|1:c' }) }).authorization.decisionId)
  assert.throws(() => decide('ProviderTransient', 'ProviderStarted', { provider: null }), /provider/)
  assert.equal(decide('Superseded', 'ProviderStarted', { provider: null }).terminalDisposition, 'Cancelled')
})

test('SPEC[failure-4] nothing accepted releases nothing; dispositions and fatality by class', () => {
  assert.equal(decide('UserCancelled', 'NoAcceptedFact').capacitySettlement, 'NoCapacitySettlement')
  assert.equal(decide('UserCancelled', 'NoAcceptedFact').capacityFence, null)
  assert.equal(decide('UserCancelled', 'NoAcceptedFact').resolution, 'PreserveCurrentFact')
  assert.equal(decide('UserCancelled', 'AcceptedBeforeProvider', { capacityFence: null }).capacitySettlement, 'NoCapacitySettlement')
  assert.equal(decide('ProtocolRejection', 'AcceptedBeforeProvider').terminalDisposition, 'Rejected')
  assert.equal(decide('AuthorizationDenied', 'ProviderStarted').terminalDisposition, 'Rejected')
  assert.equal(decide('CapacityQueueFull', 'ProviderStarted').terminalDisposition, 'Failed')
  assert.equal(decide('StreamInterruptedAfterFirstToken', 'ProviderStarted').fatality, 'NoFatality')
  for (const commitment of ['Committed', 'Unknown', 'NoNewWrite']) {
    assert.equal(decide({ kind: 'PersistenceFailure', commitment }, 'Terminal').fatality, 'FatalAfterSettlement')
  }
  assert.equal(decide({ kind: 'PersistenceFailure', commitment: 'NotCommitted' }, 'Terminal').fatality, 'NoFatality')
})

test('SPEC[failure-1] malformed input is rejected, never guessed', () => {
  assert.throws(() => policy.decide(null), /input/)
  assert.throws(() => decide('Nope', 'ProviderStarted'), /failure/)
  assert.throws(() => decide('PersistenceFailure', 'ProviderStarted'), /failure/)
  assert.throws(() => decide({ kind: 'PersistenceFailure', commitment: 'Maybe' }, 'ProviderStarted'), /commitment/)
  assert.throws(() => decide('LocalInvariant', 'Later'), /phase/)
  assert.throws(() => decide('LocalInvariant', 'ProviderStarted', { executionKey: undefined }), /executionKey/)
  assert.throws(() => decide('LocalInvariant', 'ProviderStarted', { provider: provider({ breaker: 'Half' }) }), /breaker/)
  assert.throws(() => decide('LocalInvariant', 'ProviderStarted', { provider: provider({ logicalRun: ' ' }) }), /logicalRun/)
})
