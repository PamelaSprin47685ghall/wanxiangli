import { ExecutionRouting, type ExecutionRoutingRequest, type ExecutionRoutingPolicy, type ExecutionRoutingAcquisition } from 'wanxiangli/routing'

const policy: ExecutionRoutingPolicy = (_role, running, previous) => previous ?? running[0] ?? null
const runtime = new ExecutionRouting({ scheduler: policy, binding: {
  applies: role => role === 'fixed', read: () => null, error: event => new Error(event.kind),
} })
const request: ExecutionRoutingRequest = {
  sessionId: 'session', physicalUserMessageId: 'physical', role: 'worker', participant: 'worker',
  hostTarget: { model: 'provider/model', reasoning: 'none' },
}
let result: ExecutionRoutingAcquisition = await runtime.acquire(request)
if (result.kind === 'Queued') result = await result.node.completion
if (result.kind === 'Admitted') {
  runtime.commit(result.lease, result.lease.identity)
  runtime.retainInput(result.lease, 'next')
  await runtime.continue(result.lease, 'next')
}
runtime.reserve({ sessionId: 'reserve', role: 'worker' })
await runtime.enterStep({ sessionId: 'session', physicalUserMessageId: 'physical', visibleProviderRuns: ['run'] })
runtime.snapshot().tokens.forEach(token => { void token.owner.participant })
runtime.releasePhysical('session', 'physical')
// @ts-expect-error 物理准入必须提供 participant。
runtime.acquire({ sessionId: 'session', physicalUserMessageId: 'physical', role: 'worker' })
// @ts-expect-error 固定目标查询是同步操作。
new ExecutionRouting({ scheduler: null, binding: { applies: () => true, read: async () => null, error: () => new Error() } })
