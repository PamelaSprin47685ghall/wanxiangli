import test from 'node:test'
import assert from 'node:assert/strict'
import { DurableProviderBudget, ProviderFailureBudget } from 'wanxiangli/failure-budget'

const law = new ProviderFailureBudget()
function fixture({ failAt = -1, initial = law.forAuthority('logical', 'root') } = {}) {
  let state = initial
  const writes = []
  const failure = { cause: 'physical-write' }
  const owner = new DurableProviderBudget({
    current: () => state,
    async append(event) {
      writes.push(event)
      if (writes.length === failAt) return { ok: false, error: failure }
      if (event.kind === 'FailureRecorded') {
        state = law.applyFailure({ sessionId: event.sessionId, logicalRun: event.logicalRun,
          authorityRoot: event.authorityRoot, providerRun: event.providerRun }, event.count, state).state
      } else if (event.kind === 'RetryExhausted') state = law.applyExhausted(state)
      else state = law.recordSuccess(state)
      return { ok: true }
    },
  })
  return { owner, writes, failure, state: () => state }
}
const authorization = run => ({ logicalRun: 'logical', providerRun: run })

test('durable budget rereads current and replays the latest exact failure without a second append', async () => {
  const f = fixture()
  assert.equal((await f.owner.recordAuthorizedFailure('s', authorization('p1'), 'bad')).value, 'RetryAuthorized')
  assert.equal((await f.owner.recordAuthorizedFailure('s', authorization('p1'), 'bad')).value, 'RetryAuthorized')
  await f.owner.recordAuthorizedFailure('s', authorization('p2'), 'bad')
  assert.equal((await f.owner.recordAuthorizedFailure('s', authorization('p1'), 'bad')).value, 'EpisodeSuperseded')
  assert.equal(f.writes.length, 2)
})

test('durable exhaustion failure preserves the first persisted failure and original cause', async () => {
  const initial = { ...law.forAuthority('logical', 'root'), consecutiveFailureCount: 9 }
  const f = fixture({ failAt: 2, initial })
  const answer = await f.owner.recordAuthorizedFailure('s', authorization('p10'), 'bad')
  assert.equal(answer.error, f.failure)
  assert.deepEqual(f.writes.map(w => w.kind), ['FailureRecorded', 'RetryExhausted'])
  assert.equal(f.state().consecutiveFailureCount, 10)
  assert.equal(f.state().exhausted, false)
  assert.equal((await f.owner.recordAuthorizedFailure('s', authorization('p10'), 'bad')).value, 'RetryExhausted')
  assert.equal(f.writes.length, 2)
})

test('durable success writes only for a nonzero current budget and no budget is a no-op', async () => {
  const f = fixture()
  await f.owner.recordConfirmedSuccess('s', 'p')
  assert.equal(f.writes.length, 0)
  await f.owner.recordAuthorizedFailure('s', authorization('p'), 'bad')
  await f.owner.recordConfirmedSuccess('s', 'p')
  assert.deepEqual(f.writes.map(w => w.kind), ['FailureRecorded', 'SuccessRecorded'])
  assert.equal(f.state().consecutiveFailureCount, 0)
  const absent = fixture({ initial: null })
  assert.equal((await absent.owner.recordAuthorizedFailure('s', authorization('p'), 'bad')).value, 'NoActiveRun')
  assert.equal((await absent.owner.recordConfirmedSuccess('s', 'p')).ok, true)
  assert.equal(absent.writes.length, 0)
})

test('durable budget refuses another logical run before any write and propagates rejected append', async () => {
  const f = fixture()
  assert.equal((await f.owner.recordAuthorizedFailure('s', { logicalRun: 'other', providerRun: 'p' }, 'bad')).ok, false)
  assert.equal(f.writes.length, 0)
  const error = new Error('rejected')
  const owner = new DurableProviderBudget({ current: () => law.forAuthority('logical', 'root'), append: () => Promise.reject(error) })
  await assert.rejects(owner.recordAuthorizedFailure('s', authorization('p'), 'bad'), e => e === error)
})
