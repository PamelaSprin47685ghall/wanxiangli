import assert from 'node:assert/strict'
import { DelegateInvocationRuntime } from 'wanxiangli/delegate-batch'

const runtime = new DelegateInvocationRuntime()
let sent
const started = new Promise(resolve => { sent = resolve })
let disposed = 0
const effects = {
  attach: async () => ({ ok: true, session: 'child', agent: 'engineer' }),
  cleanupDraft() {}, replaceEstimate: async () => {}, fallbackPrompt: charge => charge,
  combinePrompts: prompts => prompts.join('\n'), resolveAgent: () => null,
  subscribe: () => () => { disposed++ },
  send: async call => {
    call.invocations[0].cursor = 0n
    call.accept('input', () => {
      call.acceptedPhysical = 'input'; call.acceptedRoot = 'root'; call.admit('root')
    })
    call.invocations[0].request.observeAdmission({ kind: 'accepted', physical: 'input' })
    sent()
    return { ok: true }
  },
  notePrompt() {}, awaitView: (_, answer) => answer, awaitInvocation: (_, answer) => answer,
}
const observed = runtime.invokeObserved({
  owner: 'owner', scope: 'owner', role: 'Engineer', charge: 'work', estimate: null, batch: null,
  prepare: async () => 'work', observed: true, isCancelled: () => false, noteDraft: true,
}, effects, reason => ({ kind: 'refused', reason }))
await started
assert.deepEqual(await observed.admission, { kind: 'accepted', physical: 'input' })
assert.equal(await runtime.handleTurn({
  session: 'child', root: 'root', physical: 'input', outcome: 'completed', hasFailure: false,
  hasParts: true, naturalMaterial: 'material', response: { text: 'answer' },
}, {
  readDelivery: () => null, noteAnswer() {}, captureTerminal: async () => ({ kind: 'captured' }),
  retry: async () => ({ ok: false, error: 'exhausted' }),
}), true)
assert.deepEqual(await observed.completion, { ok: true, value: { text: 'answer' } })
assert.equal(disposed, 1)
assert.equal(runtime.peek('child'), null)
runtime.clear()
console.log(JSON.stringify({ delegateInvocation: true }))
