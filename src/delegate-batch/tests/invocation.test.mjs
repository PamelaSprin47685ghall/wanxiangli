import test from 'node:test'
import assert from 'node:assert/strict'
import { DelegateInvocationRuntime } from 'wanxiangli/delegate-batch'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const request = (scope, extra = {}) => ({
  owner: scope, scope, role: 'Engineer', charge: 'work', batch: null,
  estimate: null, prepare: async () => 'prepared', observed: false,
  isCancelled: () => false, noteDraft: true, ...extra,
})
const harness = () => {
  const runtime = new DelegateInvocationRuntime()
  runtime.clear()
  const sent = deferred()
  const events = []
  const effects = {
    attach: async input => ({ ok: true, session: `${input.scope}-child`, agent: 'engineer' }),
    cleanupDraft: () => {}, replaceEstimate: async () => {},
    fallbackPrompt: value => value, combinePrompts: values => values.join('|'),
    resolveAgent: () => null,
    subscribe: () => () => events.push('unsubscribe'),
    send: async (call, charge, prompt) => {
      for (const invocation of call.invocations) invocation.cursor = 0n
      call.accept('physical', () => {
        call.acceptedPhysical = 'physical'
        call.acceptedRoot = 'root'
        call.failureScope = { kind: 'root', root: 'root' }
        call.admit('root')
      })
      events.push(['send', charge, prompt])
      sent.resolve(call)
      return { ok: true }
    },
    notePrompt: () => {}, awaitView: (_, value) => value,
    awaitInvocation: (_, value) => value,
  }
  const terminalEffects = {
    readDelivery: () => null, noteAnswer: () => {},
    captureTerminal: async () => ({ kind: 'captured' }),
    retry: async () => ({ ok: false, error: 'exhausted' }),
  }
  const observation = scope => ({
    session: `${scope}-child`, root: 'root', physical: 'physical', outcome: 'completed',
    hasFailure: false, hasParts: true, naturalMaterial: 'natural', response: { text: 'answer' },
  })
  return { runtime, sent, events, effects, terminalEffects, observation }
}

test('invocation owns resource disposal and rejects a late registration after cancellation', async () => {
  const h = harness()
  const pending = h.runtime.invoke(request('cancel'), h.effects)
  const call = await h.sent.promise
  let disposed = 0
  call.attach(() => { disposed++ })
  h.runtime.cancelScope('cancel')
  call.attach(() => { disposed++ })
  assert.deepEqual(await pending, { ok: false, error: 'Sync delegate call was cancelled' })
  assert.equal(disposed, 2)
  assert.equal(h.runtime.peek('cancel-child'), null)
  assert.equal(call.owns('physical'), false)
  assert.equal(h.events.filter(event => event === 'unsubscribe').length, 1)
  h.runtime.clear()
})

test('native workflow settles its own natural completion and captures only the first exact response', async () => {
  const h = harness()
  const responses = []
  const pending = h.runtime.invoke(request('complete', { captureResponse: value => responses.push(value) }), h.effects)
  await h.sent.promise
  const observation = h.observation('complete')
  assert.equal(await h.runtime.handleTurn({ ...observation, root: 'old-root' }, h.terminalEffects), false)
  assert.equal(await h.runtime.handleTurn(observation, h.terminalEffects), true)
  assert.deepEqual(await pending, { ok: true, value: 'natural' })
  assert.equal(h.runtime.settleCompleted(observation, h.terminalEffects), false)
  assert.deepEqual(responses, [{ text: 'answer' }])
  h.runtime.clear()
})

test('aborted invocation without delivery stays open and a committed delivery may settle it', async () => {
  const h = harness()
  const pending = h.runtime.invoke(request('abort'), h.effects)
  await h.sent.promise
  const observation = { ...h.observation('abort'), outcome: 'aborted' }
  assert.equal(await h.runtime.handleTurn(observation, h.terminalEffects), false)
  assert.notEqual(h.runtime.peek('abort-child'), null)
  assert.equal(await h.runtime.handleTurn(observation, { ...h.terminalEffects, readDelivery: () => 'delivered' }), true)
  assert.deepEqual(await pending, { ok: true, value: 'delivered' })
  h.runtime.clear()
})

test('observed preparation failure is not sent and releases the next invocation admission', async () => {
  const h = harness()
  const failure = await h.runtime.invoke(request('prepare', { observed: true, prepare: async () => { throw new Error('prepare failed') } }), h.effects)
  assert.deepEqual(failure, { ok: false, error: 'prepare failed' })
  assert.deepEqual(h.events, [])
  const next = h.runtime.invoke(request('prepare'), h.effects)
  await h.sent.promise
  await h.runtime.handleTurn(h.observation('prepare'), h.terminalEffects)
  assert.deepEqual(await next, { ok: true, value: 'natural' })
  h.runtime.clear()
})
