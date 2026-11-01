import assert from 'node:assert/strict'
import { DispatchAttempt, PromptPhysicalAcceptance } from 'wanxiangli/dispatch'

const acceptance = new PromptPhysicalAcceptance()
const attempt = new DispatchAttempt(acceptance)
const owned = []
const steps = []
const spec = {
  key: 'installed-dispatch', mode: 'await',
  observer: {
    notify: physical => steps.push(`notify:${physical}`),
    own: lease => owned.push(lease),
    budget: 1000,
  },
}
const ok = () => ({ ok: true, value: undefined })
const effects = {
  subscribe: () => {
    steps.push('subscribe')
    return { dispose: () => steps.push('dispose') }
  },
  send: late => {
    assert.equal(late, null)
    steps.push('send')
    return Promise.resolve({ kind: 'AdmittedWithReceipt', receipt: 'receipt' })
  },
  submitted: async receipt => {
    steps.push(`submitted:${receipt}`)
    acceptance.accepted(spec.key, 'physical')
    return ok()
  },
  acceptPhysical: async () => { throw new Error('receipt requires observed physical acceptance') },
  abandon: async () => { throw new Error('unexpected abandonment') },
  diagnostic: event => { throw new Error(`unexpected diagnostic ${event.kind}`) },
}
try {
  assert.deepEqual(await attempt.sendInitial(spec, effects), { kind: 'Sent', key: spec.key })
  assert.deepEqual(steps, ['subscribe', 'send', 'submitted:receipt', 'notify:physical', 'dispose'])
  steps.length = 0
  assert.deepEqual(await attempt.sendContinuation({ key: 'continuation', mode: 'await' }, {
    ...effects,
    admit: () => {
      steps.push('admit')
      queueMicrotask(() => steps.push('new-material'))
      return { kind: 'allowed' }
    },
    send: () => {
      steps.push('send')
      return Promise.resolve({ kind: 'AdmittedWithPhysicalMessage', physicalUserMessageId: 'next-physical' })
    },
    submitted: async value => { steps.push(`submitted:${value}`); return ok() },
    acceptPhysical: async value => { steps.push(`accepted:${value}`); return ok() },
  }), { kind: 'Sent', key: 'continuation' })
  assert.deepEqual(steps, ['subscribe', 'admit', 'send', 'new-material', 'submitted:next-physical', 'accepted:next-physical', 'dispose'])
} finally {
  for (const lease of owned) lease.dispose()
  acceptance.clear()
}
console.log(JSON.stringify({ dispatchAttempt: true }))
