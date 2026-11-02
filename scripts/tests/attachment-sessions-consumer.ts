import {
  AttachmentLeaseRegistry, AttachmentSessions,
  type AttachedSessionEffects, type AssociatedSessionEffects,
  type AttachmentResult, type AttachmentSessionLease,
} from 'wanxiangli/attachment-lease'

const registry = new AttachmentLeaseRegistry()
const sessions = new AttachmentSessions(registry)
const request = { owner: 'owner', kind: 'worker', agent: 'agent', directory: null }
const effects: AttachedSessionEffects = {
  isUsable: () => true,
  observe: async ({ owner }) => ({ ok: true, value: owner === 'owner' ? null : 'existing' }),
  create: async ({ agent }) => ({ ok: true, value: agent + '-child' }),
  link: async ({ sessionId }) => sessionId ? { ok: true, value: undefined } : { ok: false, error: 'missing' },
}
const result: AttachmentResult<AttachmentSessionLease> = await sessions.getOrCreate(request, effects)
if (result.ok) sessions.tryFindOwner(result.value.sessionId, 'worker')
const associated: AssociatedSessionEffects = {
  ...effects,
  list: async () => ({ ok: true, value: [] }),
  abort: async () => ({ ok: true, value: undefined }),
  close: async () => ({ ok: true, value: undefined }),
  rejection: ({ rejection, child }) => `${rejection}: ${child}`,
}
await sessions.ensureAssociated({ ...request, title: 'title', restoreHint: null }, associated)
await sessions.retireAssociated('owner', 'worker', associated)
sessions.tryFind('owner', 'worker', effects.isUsable)
sessions.remove('owner', 'worker')
sessions.removeByChild('child')
sessions.clearKinds(['worker'] as const)
// @ts-expect-error The shared registry is required.
new AttachmentSessions()
// @ts-expect-error Callback results use the native result shape.
sessions.getOrCreate(request, { ...effects, observe: async () => ({ tag: 0, fields: [null] }) })
