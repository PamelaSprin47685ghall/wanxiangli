import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Ownership } from 'wanxiangli/ownership'

export const open = (scopeId = 'work', parentId = null) => ({ type: 'OpenScope', scopeId, parentId })
export const reserve = (resourceId = 'resource', scopeId = 'work', kind = 'process') => ({ type: 'Reserve', resourceId, scopeId, kind })
export const binding = (externalId = 'container', incarnationId = 'instance-1') => ({ externalId, incarnationId })
export const started = (lease, target = binding()) => ({ type: 'Started', lease, binding: target })
export const ended = (lease, target = binding(), outcome = 'Completed') => ({ type: 'Ended', lease, binding: target, outcome })
export class Rig {
  serial = 0
  constructor(id = 'registry') { this.owner = new Ownership(id) }
  call(message, request = `request-${++this.serial}`) { return this.owner.execute(request, message) }
  apply(message, request) {
    const reply = this.call(message, request)
    assert.equal(reply.status, 'Applied')
    return reply.result
  }
  open(id = 'work', parent = null) { return this.apply(open(id, parent)) }
  reserve(id = 'resource', scope = 'work', kind = 'process') { return this.apply(reserve(id, scope, kind)).lease }
}
export function unchanged(owner, action, pattern) {
  const records = owner.records()
  const snapshot = owner.inspect()
  assert.throws(action, pattern)
  assert.deepEqual(owner.records(), records)
  assert.deepEqual(owner.inspect(), snapshot)
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export function resign(frames) {
  const hash = text => createHash('sha256').update(text).digest('hex')
  let previous = hash(JSON.stringify(['ownership-origin-v1', frames[0].registryId]))
  return frames.map((frame, index) => {
    const value = { registryId: frame.registryId, revision: index + 1, previous, requestId: frame.requestId, message: frame.message }
    previous = hash(canonical(value))
    return canonical({ ...value, digest: previous })
  })
}
