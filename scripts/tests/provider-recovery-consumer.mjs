import assert from 'node:assert/strict'
import { DurableProviderBudget, ProviderFailureBudget } from 'wanxiangli/failure-budget'
import { ProviderRecovery, ExecutionFailurePolicy } from 'wanxiangli/failure'
const law = new ProviderFailureBudget()
let state = law.forAuthority('logical', 'root')
const budget = new DurableProviderBudget({ current: () => state, async append(event) {
  state = law.applyFailure({ sessionId: event.sessionId, logicalRun: event.logicalRun,
    authorityRoot: event.authorityRoot, providerRun: event.providerRun }, event.count, state).state
  return { ok: true }
} })
const decision = new ExecutionFailurePolicy().decide({ failure: 'ProviderTransient', phase: 'ProviderStarted', executionKey: {},
  provider: { logicalRun: 'logical', providerRun: 'p', requestKind: 'WorkMain', retryBudget: 'Available', breaker: 'Closed' } })
const recovery = new ProviderRecovery()
let dispatches = 0
const answer = await recovery.attempt(decision, {
  admit: auth => budget.recordAuthorizedFailure('s', auth, 'gateway'),
  redispatch: auth => recovery.redispatch('root', auth, {
    alreadyAdmitted: () => false, observeAcceptance: () => {}, waitForStop: async () => 'Stopped',
    currentAuthority: () => ({ root: 'root', value: 'profile' }),
    sendRetry: async (profile, authorization) => {
      assert.equal(profile, 'profile'); assert.equal(authorization, decision.authorization)
      dispatches++; return { kind: 'Sent' }
    },
  }, 'gateway'),
}, 'gateway')
assert.equal(answer.kind, 'Dispatched')
assert.equal(state.consecutiveFailureCount, 1)
assert.equal(dispatches, 1)
console.log(JSON.stringify({ providerRecovery: true }))
