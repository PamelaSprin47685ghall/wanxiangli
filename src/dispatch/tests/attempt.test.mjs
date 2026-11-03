import test from 'node:test'
import assert from 'node:assert/strict'
import { DispatchAttempt, PromptPhysicalAcceptance } from 'wanxiangli/dispatch'

const ok = () => ({ ok: true, value: undefined })
const error = reason => ({ ok: false, error: reason })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function fixture(t) {
  const acceptance = new PromptPhysicalAcceptance()
  const attempt = new DispatchAttempt(acceptance)
  const steps = []
  const leases = []
  const notifications = []
  const observer = {
    budget: 1000,
    notify: physical => { notifications.push(physical); steps.push('notify') },
    own: lease => { leases.push(lease); steps.push('own') },
  }
  t.after(() => { for (const lease of leases) lease.dispose(); acceptance.clear() })
  const spec = { key: 'key', mode: 'await' }
  const effects = {
    subscribe: () => { steps.push('subscribe'); return { dispose: () => steps.push('dispose') } },
    send: () => { steps.push('send'); return Promise.resolve({ kind: 'AdmittedWithReceipt', receipt: 'receipt' }) },
    submitted: async receipt => { steps.push(['submitted', receipt]); return ok() },
    acceptPhysical: async physical => { steps.push(['accepted', physical]); acceptance.accepted('key', physical); return ok() },
    abandon: async reason => { steps.push(['abandon', reason]); acceptance.cancel('key'); return ok() },
    admit: () => { steps.push('admit'); return { kind: 'allowed' } },
    diagnostic: event => { steps.push(['diagnostic', event]) },
  }
  return { acceptance, attempt, steps, leases, notifications, observer, spec, effects }
}

test('DispatchAttempt owns acceptance before sending and waits for the receipt physical confirmation', async t => {
  const h = fixture(t)
  const result = await h.attempt.sendInitial({ ...h.spec, observer: h.observer, observed: event => h.steps.push(event.kind) }, {
    ...h.effects,
    send: late => {
      assert.equal(late, null)
      assert.equal(h.leases.length, 2)
      h.steps.push('send')
      return Promise.resolve({ kind: 'AdmittedWithReceipt', receipt: 'receipt' })
    },
    submitted: async receipt => { h.steps.push(['submitted', receipt]); h.acceptance.accepted('key', 'physical'); return ok() },
  })
  assert.deepEqual(result, { kind: 'Sent', key: 'key' })
  assert.deepEqual(h.steps, ['subscribe', 'own', 'own', 'Sending', 'send', 'Answered', ['submitted', 'receipt'], 'notify', 'dispose'])
  assert.deepEqual(h.notifications, ['physical'])
})

test('DispatchAttempt continuation calls send before an admit microtask can publish newer material', async t => {
  const h = fixture(t)
  const result = await h.attempt.sendContinuation(h.spec, {
    ...h.effects,
    admit: () => {
      h.steps.push('admit')
      queueMicrotask(() => h.steps.push('new-material'))
      return { kind: 'allowed' }
    },
  })
  assert.deepEqual(result, { kind: 'Sent', key: 'key' })
  assert.deepEqual(h.steps, ['subscribe', 'admit', 'send', 'new-material', ['submitted', 'receipt'], 'dispose'])
})

test('DispatchAttempt records physical replies in submitted then accepted order', async t => {
  const h = fixture(t)
  const result = await h.attempt.sendInitial(h.spec, {
    ...h.effects,
    send: () => Promise.resolve({ kind: 'AdmittedWithPhysicalMessage', physicalUserMessageId: 'physical' }),
  })
  assert.deepEqual(result, { kind: 'Sent', key: 'key' })
  assert.deepEqual(h.steps, ['subscribe', ['submitted', 'physical'], ['accepted', 'physical'], 'dispose'])
})

test('DispatchAttempt detached return does not await a transport promise that never completes', { timeout: 2000 }, async t => {
  const h = fixture(t)
  let late
  const result = await h.attempt.sendInitial({ ...h.spec, mode: 'detached' }, {
    ...h.effects,
    send: listener => { late = listener; h.steps.push('send'); return new Promise(() => {}) },
  })
  assert.deepEqual(result, { kind: 'Sent', key: 'key' })
  assert.deepEqual(h.steps, ['subscribe', 'send', ['submitted', 'accepted-detached-key'], 'dispose'])
  await late({ kind: 'OwnedSettled' })
  assert.equal(h.steps.length, 4)
  await assert.rejects(late({ kind: 'unexpected' }), /malformed detached verdict/)
})

for (const method of ['sendInitial', 'sendContinuation']) {
  test(`DispatchAttempt ${method} preserves its detached persistence-failure registration lifetime`, async t => {
    const h = fixture(t)
    const result = await h.attempt[method]({ ...h.spec, mode: 'detached', observer: h.observer }, {
      ...h.effects,
      submitted: async () => error('persist failed'),
    })
    assert.deepEqual(result, { kind: 'Failed', reason: 'persist failed' })
    h.acceptance.accepted('key', 'later')
    assert.deepEqual(h.notifications, method === 'sendInitial' ? ['later'] : [])
    assert.equal(h.steps.filter(step => step === 'dispose').length, 1)
  })
}

test('DispatchAttempt keeps SDK unknown and late refusal as two independent settlement paths', async t => {
  const h = fixture(t)
  const unknownSeen = deferred()
  const failures = []
  let late
  const result = await h.attempt.sendInitial({
    ...h.spec, mode: 'detached',
    onFailure: async verdict => { failures.push(verdict); if (verdict.kind === 'OutcomeUnknown') unknownSeen.resolve() },
  }, {
    ...h.effects,
    send: listener => { late = listener; return Promise.resolve({ kind: 'AcceptanceUnknown', reason: 'sdk unknown' }) },
    abandon: async reason => { h.steps.push(['abandon', reason]); return error('append not committed') },
  })
  assert.deepEqual(result, { kind: 'Sent', key: 'key' })
  await unknownSeen.promise
  await late({ kind: 'Refused', reason: 'late refusal' })
  assert.deepEqual(failures, [{ kind: 'OutcomeUnknown', reason: 'sdk unknown' }, { kind: 'Refused', reason: 'late refusal' }])
  assert.deepEqual(h.steps.filter(Array.isArray), [
    ['submitted', 'accepted-detached-key'],
    ['diagnostic', { kind: 'outcome-unknown', reason: 'sdk unknown' }],
    ['abandon', { kind: 'send-failed', reason: 'late refusal' }],
    ['diagnostic', { kind: 'abandon-uncommitted', reason: 'append not committed' }],
  ])
})

for (const rejects of [false, true]) {
  test(`DispatchAttempt refusal classification preserves abandon ${rejects ? 'rejection' : 'Result error'} behavior`, async t => {
    const h = fixture(t)
    const result = await h.attempt.sendContinuation(h.spec, {
      ...h.effects,
      send: () => Promise.resolve({ kind: 'Retryable', reason: 'send refused' }),
      abandon: async () => { if (rejects) throw new Error('append rejected'); return error('append failed') },
    })
    assert.deepEqual(result, rejects ? { kind: 'Failed', reason: 'append rejected' } : { kind: 'NotSent', reason: 'send refused' })
  })
}

test('DispatchAttempt unknown await keeps the claim pending and does not resend or accept', async t => {
  const h = fixture(t)
  const result = await h.attempt.sendInitial({ ...h.spec, observer: h.observer }, {
    ...h.effects,
    send: () => { h.steps.push('send'); return Promise.resolve({ kind: 'AcceptanceUnknown', reason: 'transport lost' }) },
  })
  assert.deepEqual(result, { kind: 'Failed', reason: 'Acceptance unknown for PromptKey key: transport lost' })
  assert.deepEqual(h.steps, ['subscribe', 'own', 'own', 'send', 'dispose'])
  h.acceptance.accepted('key', 'late')
  assert.deepEqual(h.notifications, [])
})

for (const abandonFails of [false, true]) {
  test(`DispatchAttempt admission rejection preserves its original object unless abandon fails=${abandonFails}`, async t => {
    const h = fixture(t)
    const failure = { generation: 7, reason: 'superseded' }
    const result = await h.attempt.sendContinuation({ ...h.spec, observer: h.observer }, {
      ...h.effects,
      admit: () => ({ kind: 'rejected', failure }),
      send: () => assert.fail('admission was rejected'),
      abandon: async request => {
        assert.deepEqual(request, { kind: 'superseded' })
        h.acceptance.accepted('key', 'already-unregistered')
        return abandonFails ? error('append failed') : ok()
      },
    })
    if (abandonFails) assert.deepEqual(result, { kind: 'Failed', reason: 'append failed' })
    else { assert.equal(result.kind, 'AdmissionRejected'); assert.strictEqual(result.failure, failure) }
    assert.deepEqual(h.notifications, [])
  })
}

for (const throwAt of [1, 2]) {
  test(`DispatchAttempt disposes newly owned resources when observer own throws at lease ${throwAt}`, async t => {
    const h = fixture(t)
    const failure = new Error('cannot own lease')
    let count = 0
    const observer = { ...h.observer, own: lease => { h.leases.push(lease); if (++count === throwAt) throw failure } }
    await assert.rejects(h.attempt.sendInitial({ ...h.spec, observer }, {
      ...h.effects, send: () => assert.fail('ownership failed before send'),
    }), candidate => candidate === failure)
    h.acceptance.accepted('key', 'late')
    assert.deepEqual(h.notifications, [])
    assert.deepEqual(h.steps, ['subscribe', 'dispose'])
  })
}

test('DispatchAttempt preserves confirmation rejection text and terminal-dispose exceptions', async t => {
  const h = fixture(t)
  const rejected = await h.attempt.sendInitial({ ...h.spec, observer: h.observer }, {
    ...h.effects,
    submitted: async () => { h.acceptance.rejected('key', 'not admitted'); return ok() },
  })
  assert.deepEqual(rejected, { kind: 'Failed', reason: 'Prompt admission rejected: not admitted' })
  const failure = new Error('terminal dispose failed')
  await assert.rejects(h.attempt.sendInitial(h.spec, {
    ...h.effects, subscribe: () => ({ dispose() { throw failure } }),
  }), candidate => candidate === failure)
})
