import { DurableProviderBudget, ProviderFailureBudget } from 'wanxiangli/failure-budget'
import { ProviderRecovery, ExecutionFailurePolicy, type RecoveryAuthorization, type RetryVerdict } from 'wanxiangli/failure'
const state = new ProviderFailureBudget().forAuthority('logical', 'root')
const budget = new DurableProviderBudget<string>({ current: () => state, append: async () => ({ ok: true }) })
const decision = new ExecutionFailurePolicy().decide({ failure: 'ProviderTransient', phase: 'ProviderStarted', executionKey: {},
  provider: { logicalRun: 'logical', providerRun: 'p', requestKind: 'WorkMain', retryBudget: 'Available', breaker: 'Closed' } })
const authorization = decision.authorization!
const recovery = new ProviderRecovery()
const answer: Promise<RetryVerdict> = recovery.attempt<RecoveryAuthorization>(
  { resolution: decision.resolution, authorization },
  { admit: auth => budget.recordAuthorizedFailure('s', auth, 'gateway'), redispatch: async () => ({ kind: 'Dispatched' }) }, 'gateway')
void answer
