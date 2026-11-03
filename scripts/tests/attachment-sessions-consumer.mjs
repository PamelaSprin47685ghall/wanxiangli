import assert from 'node:assert/strict'
import { AttachmentLeaseRegistry, AttachmentSessions } from 'wanxiangli/attachment-lease'

const registry = new AttachmentLeaseRegistry()
const sessions = new AttachmentSessions(registry)
const steps = []
const request = { owner: 'owner', kind: 'worker', agent: 'first-agent', directory: null }
const effects = {
  isUsable: () => true,
  observe: async () => ({ ok: true, value: null }),
  create: async input => {
    assert.deepEqual(input, { owner: 'owner', agent: 'first-agent', directory: null })
    steps.push('create')
    return { ok: true, value: 'child' }
  },
  link: async input => {
    assert.deepEqual(input, { owner: 'owner', sessionId: 'child', agent: 'first-agent' })
    steps.push('link')
    return { ok: true, value: undefined }
  },
}
const first = await sessions.getOrCreate(request, effects)
assert.deepEqual(first, { ok: true, value: { sessionId: 'child', origin: 'Created', agent: 'first-agent' } })
assert.deepEqual(await sessions.getOrCreate({ ...request, agent: 'changed-agent' }, effects), first)
assert.equal(sessions.tryFindOwner('child', 'worker'), 'owner')
assert.deepEqual(await sessions.retireAssociated('owner', 'worker', {
  abort: async input => {
    assert.deepEqual(input, { sessionId: 'child' })
    steps.push('abort')
    return { ok: true, value: undefined }
  },
  close: async input => {
    assert.deepEqual(input, { owner: 'owner' })
    steps.push('close')
    return { ok: true, value: undefined }
  },
}), { ok: true, value: undefined })
assert.equal(registry.tryFind('owner', 'worker'), undefined)
assert.equal(registry.inFlightCount(), 0)
assert.deepEqual(steps, ['create', 'link', 'abort', 'close'])
console.log(JSON.stringify({ attachmentSessions: true }))
