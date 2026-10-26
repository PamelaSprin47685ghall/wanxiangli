import assert from 'node:assert/strict'
import { Work } from 'wanxiangli/work'

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export class Rig {
  serial = 0
  constructor(office = 'Plan', workId = 'work-a') {
    this.office = office
    this.workId = workId
    this.work = new Work(workId)
  }
  get count() { return this.work.records().length }
  call(command, requestId = `request-${++this.serial}`) {
    return this.work.execute(requestId, command)
  }
  apply(command, requestId) {
    const reply = this.call(command, requestId)
    assert.equal(reply.status, 'Applied', `${reply.status} ${reply.reason ?? ''} ${JSON.stringify(reply.result)}`)
    assert.equal(reply.record, this.work.records().at(-1))
    return reply.result
  }
  review(updates = [], overrides = {}, requestId) {
    const command = {
      type: 'Review',
      office: this.office,
      providerRunId: 'run-1',
      toolCallId: `call-${++this.serial}`,
      updates,
      ...overrides,
    }
    this.lastCommand = command
    return this.apply(command, requestId)
  }
  answer(messageId = `msg-${++this.serial}`) {
    return this.apply({ type: 'OperatorAnswer', messageId })
  }
  confirm(effect, outcome, extra = {}, requestId) {
    return this.apply({ type: 'Confirm', effectId: effect.id, outcome, ...extra }, requestId)
  }
  park(result) {
    assert.equal(result.kind, 'Asked')
    assert.equal(result.effect.text, '我需要干什么？')
    this.confirm(result.effect, 'Parked')
    return this.answer()
  }
  send(result) {
    assert.equal(result.effect.kind, 'Dispatch')
    return this.confirm(result.effect, 'Sent')
  }
  restored() {
    const copy = new Work(this.workId, this.work.records())
    assert.deepEqual(copy.inspect(), this.work.inspect())
    assert.deepEqual(copy.recover().wait, this.work.recover().wait)
    assert.deepEqual(copy.recover().next, this.work.recover().next)
    assert.deepEqual(copy.recover().effect, this.work.recover().effect)
    return copy
  }
}

export function reachReady(rig) {
  for (const next of ['理解与路径', '流程与伪代码', '待执行']) {
    rig.review([{ key: 'item', value: 'keep' }])
    const relay = rig.review([{ key: 'item', value: null }])
    assert.equal(relay.kind, 'Relayed')
    rig.send(relay)
    const advanced = rig.review([])
    assert.equal(advanced.kind, 'Advanced')
    assert.equal(advanced.milestone, next)
    assert.equal(advanced.incumbencyId, relay.successorId)
    rig.send(advanced)
  }
  assert.equal(rig.work.inspect().milestone, '待执行')
  assert.equal(rig.work.inspect().phase, 'Ready')
}
