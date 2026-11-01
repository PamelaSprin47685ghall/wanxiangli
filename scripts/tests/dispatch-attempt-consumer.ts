import {
  DispatchAttempt, PromptPhysicalAcceptance,
  type DispatchAttemptEffects, type DispatchAttemptSpec, type DispatchAttemptOutcome,
} from 'wanxiangli/dispatch'

const acceptance = new PromptPhysicalAcceptance()
const attempt = new DispatchAttempt(acceptance)
const spec: DispatchAttemptSpec = {
  key: 'key', mode: 'await',
  observer: { notify: () => {}, own: lease => lease.dispose(), budget: 1000 },
  observed: event => { if (event.kind === 'Answered') void event.outcome.kind },
  onFailure: async verdict => { if (verdict.kind !== 'OwnedSettled') void verdict.reason },
}
const effects: DispatchAttemptEffects = {
  subscribe: () => ({ dispose() {} }),
  send: async late => {
    if (late) await late({ kind: 'OwnedSettled' })
    return { kind: 'AdmittedWithReceipt', receipt: 'receipt' }
  },
  submitted: async () => ({ ok: true, value: undefined }),
  acceptPhysical: async () => ({ ok: true, value: undefined }),
  abandon: async () => ({ ok: false, error: 'uncommitted' }),
  diagnostic: event => { void event.reason },
}
await attempt.sendInitial(spec, effects)
const failure = { revision: 3 }
const result: DispatchAttemptOutcome<typeof failure> = await attempt.sendContinuation(spec, {
  ...effects, admit: () => ({ kind: 'rejected', failure }),
})
if (result.kind === 'AdmissionRejected') void result.failure.revision
// @ts-expect-error The acceptance owner must be supplied.
new DispatchAttempt()
// @ts-expect-error Admission is synchronous.
attempt.sendContinuation(spec, { ...effects, admit: async () => ({ kind: 'allowed' }) })
// @ts-expect-error A receipt is required for the admitted receipt variant.
attempt.sendInitial(spec, { ...effects, send: async () => ({ kind: 'AdmittedWithReceipt' }) })
