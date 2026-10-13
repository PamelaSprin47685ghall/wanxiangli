import assert from 'node:assert/strict'
import { Work } from 'wanxiangli/work'

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// 只实现原子存储契约，不重写任何生命周期规则。
export class MemoryJournal {
  streams = new Map()
  calls = 0
  read(stream) { return (this.streams.get(stream) ?? []).map(entry => entry.body) }
  append(stream, expectedRevision, requestId, body) {
    this.calls += 1
    const entries = this.streams.get(stream) ?? []
    const index = entries.findIndex(entry => entry.requestId === requestId)
    if (index >= 0) {
      return { status: entries[index].body === body ? 'Replayed' : 'Conflict', revision: index + 1, reason: null }
    }
    if (entries.length !== expectedRevision) return { status: 'Conflict', revision: entries.length, reason: 'RevisionConflict' }
    entries.push({ requestId, body })
    this.streams.set(stream, entries)
    return { status: 'Committed', revision: entries.length, reason: null }
  }
}

export class Rig {
  serial = 0
  constructor(sequence = ['S1', 'S2', 'S3'], journal = new MemoryJournal()) {
    this.journal = journal
    this.work = new Work('work-a', journal)
    this.sequence = sequence
  }
  call(command, requestId = `request-${++this.serial}`) { return this.work.execute(requestId, command) }
  commit(command, requestId) {
    const reply = this.call(command, requestId)
    assert.equal(reply.status, 'Committed', JSON.stringify(reply))
    return reply.result
  }
  open(overrides = {}) {
    this.openCommand = { type: 'Open', root: '用户的工作 🧭\n第二行', sequence: this.sequence, ownerId: 'manager', openingCursor: 0, ...overrides }
    return this.commit(this.openCommand, 'open')
  }
  review(findings = [], overrides = {}) {
    return this.commit({ type: 'Review', incumbencyId: this.work.inspect().active.id, reviewerId: 'reviewer', findings, ...overrides })
  }
  delivery(overrides = {}) {
    const state = this.work.inspect()
    return { type: 'Deliver', incumbencyId: state.active?.id ?? 'retired', providerRunId: 'run-1', toolCallId: `call-${++this.serial}`,
      cursor: Math.max(state.revision + 1, (state.active?.openingCursor ?? 0) + 1), blockers: [], nextOwnerId: 'manager', ...overrides }
  }
  deliver(overrides = {}) {
    this.lastDelivery = this.delivery(overrides)
    return this.commit(this.lastDelivery)
  }
  authorizePlan() {
    this.open()
    for (let index = 0; index < 3; index++) {
      this.review()
      if (index < 2) this.deliver()
    }
    assert.equal(this.work.inspect().deliveryAuthorized, true)
  }
  reserve() {
    this.authorizePlan()
    const command = this.delivery({ draft: { digest: 'draft-digest', path: '/plans/approved.md' } })
    const reply = this.call(command, 'reserve')
    assert.equal(reply.status, 'Committed')
    return { command, reply, operationId: reply.result.operationId }
  }
  accepted(operationId, overrides = {}) {
    return { type: 'ResolveDelivery', operationId, outcome: 'Accepted', execSessionId: 'execution-session', digest: 'draft-digest', path: '/plans/approved.md', blockers: [], ...overrides }
  }
  eventTypes() { return this.work.history().flatMap(frame => frame.events.map(event => event.type)) }
}
