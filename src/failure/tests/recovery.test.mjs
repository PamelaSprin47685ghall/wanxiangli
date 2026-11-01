import test from 'node:test'
import assert from 'node:assert/strict'
import { ProviderRecovery, ExecutionFailurePolicy } from 'wanxiangli/failure'
import { DurableProviderBudget, ProviderFailureBudget } from 'wanxiangli/failure-budget'

const recovery = new ProviderRecovery()
const input = { reason: 'gateway', hardStop: false, hasCapacity: true, hasRecovery: true,
  continueLongWork: false, expectedRoot: 'root' }
const forbidden = () => { throw new Error('unexpected effect') }

test('recovery composes a real policy, durable budget and one dispatch with the same authorization', async () => {
  const law = new ProviderFailureBudget()
  let state = law.forAuthority('logical', 'root')
  const budget = new DurableProviderBudget({ current: () => state, async append(event) {
    state = law.applyFailure({ sessionId: event.sessionId, logicalRun: event.logicalRun,
      authorityRoot: event.authorityRoot, providerRun: event.providerRun }, event.count, state).state
    return { ok: true }
  } })
  const decision = new ExecutionFailurePolicy().decide({ failure: 'ProviderTransient', phase: 'ProviderStarted',
    executionKey: {}, provider: { logicalRun: 'logical', providerRun: 'p', requestKind: 'WorkMain', retryBudget: 'Available', breaker: 'Closed' } })
  let sends = 0
  const effects = {
    admit: auth => budget.recordAuthorizedFailure('s', auth, 'gateway'),
    redispatch: auth => recovery.redispatch('root', auth, {
      alreadyAdmitted: () => false, observeAcceptance: seen => assert.equal(seen, decision.authorization),
      waitForStop: async () => 'Stopped', currentAuthority: () => ({ root: 'root', value: 'profile' }),
      sendRetry: async (profile, seen) => { assert.equal(profile, 'profile'); assert.equal(seen, decision.authorization); sends++; return { kind: 'Sent' } },
    }, 'gateway'),
  }
  assert.equal((await recovery.attempt(decision, effects, 'gateway')).kind, 'Dispatched')
  assert.equal(state.consecutiveFailureCount, 1)
  assert.equal(sends, 1)
})

test('recovery waits even after admission and never sends for denied unknown or replaced authority', async () => {
  for (const [admitted, stop, root, expected] of [
    [true, 'Stopped', 'root', 'Superseded'], [false, 'Denied', 'root', 'WaitDenied'],
    [false, 'TimedOut', 'root', 'ReceiptUnknown'], [false, 'Stopped', 'new-root', 'Superseded'],
  ]) {
    const events = []
    const answer = await recovery.redispatch('root', {}, {
      alreadyAdmitted: () => { events.push('admitted'); return admitted },
      observeAcceptance: () => events.push('observe'),
      waitForStop: async () => { events.push('wait'); return stop },
      currentAuthority: () => { events.push('authority'); return { root, value: {} } }, sendRetry: forbidden,
    }, 'gateway')
    assert.equal(answer.kind, expected)
    assert.deepEqual(events.slice(0, admitted ? 3 : 2), admitted ? ['admitted', 'observe', 'wait'] : ['admitted', 'wait'])
  }
})

test('ordinary and delegate entry preserve missing-context and hard-stop priority', async () => {
  const terminal = []
  let missing = 0
  const effects = { terminal: reason => terminal.push(reason), sendMissing: async () => { missing++; return false }, retry: forbidden }
  await recovery.recoverOrdinary({ ...input, hardStop: true, hasCapacity: false, hasRecovery: false }, effects)
  assert.deepEqual(terminal, ['gateway'])
  assert.equal(missing, 0)
  assert.deepEqual(await recovery.recoverDelegate({ ...input, hasRecovery: false }, effects), { kind: 'Terminal', reason: 'gateway' })
  await recovery.recoverOrdinary({ ...input, hasRecovery: false }, effects)
  assert.equal(missing, 2)
  assert.deepEqual(terminal, ['gateway', 'gateway'])
})

test('ordinary exhausted long work rereads authority after stop and preserves late failure text', async () => {
  const events = []
  await recovery.recoverOrdinary({ ...input, continueLongWork: true }, {
    retry: async () => ({ kind: 'Terminal', reason: 'exhausted' }), sendMissing: forbidden,
    terminal: reason => events.push(reason), hardStop: () => false,
    waitForStop: async () => { events.push('wait'); return 'Stopped' },
    currentAuthority: () => { events.push('authority'); return { root: 'root', value: {} } },
    sendLong: async () => ({ kind: 'Failed', error: 'late refusal' }),
  })
  assert.deepEqual(events, ['wait', 'authority', 'exhausted; long-work continuation not sent: late refusal'])
})

test('recovery refusal and thrown effects do not authorize another dispatch', async () => {
  const authorization = {}
  for (const value of ['RetryExhausted', 'EpisodeSuperseded', 'NoActiveRun']) {
    const result = await recovery.attempt({ resolution: 'RetryFreshAttempt', authorization }, {
      admit: async () => ({ ok: true, value }), redispatch: forbidden,
    }, 'gateway')
    assert.equal(result.kind, value === 'EpisodeSuperseded' ? 'Superseded' : 'Terminal')
  }
  const error = new Error('physical unknown')
  await assert.rejects(recovery.redispatch('root', authorization, {
    alreadyAdmitted: () => false, waitForStop: () => Promise.reject(error), currentAuthority: forbidden, sendRetry: forbidden,
  }, 'gateway'), e => e === error)
})
