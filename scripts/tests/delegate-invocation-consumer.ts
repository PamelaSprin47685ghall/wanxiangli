import { DelegateInvocationRuntime } from 'wanxiangli/delegate-batch'
import type { DelegateInvocationEffects, DelegateInvocationRequest, DelegateTerminalEffects } from 'wanxiangli/delegate-batch'

const runtime = new DelegateInvocationRuntime<string, { text: string }>()
const request: DelegateInvocationRequest<string, { text: string }> = {
  owner: 'owner', scope: 'owner', role: 'Engineer', charge: 'work', estimate: null, batch: null,
  prepare: async () => 'work', observed: true, isCancelled: () => false, noteDraft: true,
}
const effects: DelegateInvocationEffects<string, { text: string }> = {
  attach: async () => ({ ok: true, session: 'child', agent: 'engineer' }),
  cleanupDraft() {}, replaceEstimate: async () => {}, fallbackPrompt: charge => charge,
  combinePrompts: prompts => prompts.join('\n'), resolveAgent: () => null,
  subscribe: () => () => {}, send: async () => ({ ok: true }), notePrompt() {},
  awaitView: (_, answer) => answer, awaitInvocation: (_, answer) => answer,
}
const terminal: DelegateTerminalEffects<string, { text: string }> = {
  readDelivery: () => null, noteAnswer() {}, captureTerminal: async () => ({ kind: 'captured' }), retry: async () => ({ ok: true }),
}
const observed = runtime.invokeObserved(request, effects, reason => ({ kind: 'refused', reason }))
const admission: Promise<{ kind: string; reason: string }> = observed.admission
void admission; void terminal
runtime.cancelScope('owner')
runtime.clear()
