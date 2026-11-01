import assert from 'node:assert/strict'
import { ExecutionRouting } from 'wanxiangli/routing'

const runtime = new ExecutionRouting({ scheduler: null })
const request = {
  sessionId: 'session', physicalUserMessageId: 'physical', role: 'worker', participant: 'worker',
  purpose: 'normal', hostTarget: { model: 'provider/model', reasoning: 'none' },
}
const admission = await runtime.acquire(request)
assert.equal(admission.kind, 'Admitted')
assert.equal((await runtime.acquire(request)).lease, admission.lease)
assert.equal(runtime.tryRead('session', 'physical'), null)
assert.equal(runtime.commit(admission.lease, admission.lease.identity), 'Applied')
assert.equal(runtime.tryRead('session', 'physical'), admission.lease)
await runtime.enterStep({ sessionId: 'session', physicalUserMessageId: 'physical', visibleProviderRuns: [], requestKey: 'request' })
assert.equal(runtime.snapshot().inFlightCount, 1)
runtime.endStep('session', 'physical', 'run')
assert.equal(runtime.snapshot().idleCount, 1)
assert.deepEqual(runtime.takeRunTarget('run'), request.hostTarget)
assert.deepEqual(runtime.releasePhysical('session', 'physical'), { kind: 'Released', outcome: 'Applied' })
assert.deepEqual(runtime.occupied(), [])
console.log(JSON.stringify({ executionRouting: true }))
