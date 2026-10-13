import test from 'node:test'
import assert from 'node:assert/strict'
import { Rig } from './support.mjs'

test('SPEC[lifecycle-006] DevOps binding is stable across relay and cannot be replaced', () => {
  const rig = new Rig()
  rig.open()
  const bind = { type: 'BindDevOps', incumbencyId: rig.work.inspect().active.id, trigger: 'Ask', devopsId: 'devops', target: '/target' }
  assert.throws(() => rig.call({ ...bind, trigger: 'Resume' }), /trigger/)
  rig.apply(bind)
  assert.equal(rig.work.inspect().canDispatchDevOps, false)
  rig.review()
  assert.equal(rig.work.inspect().canDispatchDevOps, true)
  rig.deliver()
  assert.equal(rig.work.inspect().devopsId, 'devops')
  assert.equal(rig.work.inspect().canDispatchDevOps, false)
  const current = { ...bind, incumbencyId: rig.work.inspect().active.id }
  assert.equal(rig.call(current).result.kind, 'DevOpsBound')
  assert.throws(() => rig.call({ ...current, devopsId: 'replacement' }), /conflict/)
})

test('SPEC[lifecycle-006] S4 binds on Resume or Horizon, not Ask', () => {
  const rig = new Rig(['S4'])
  rig.open()
  const bind = { type: 'BindDevOps', incumbencyId: rig.work.inspect().active.id, trigger: 'Ask', devopsId: 'devops', target: null }
  assert.throws(() => rig.call(bind), /trigger/)
  rig.apply({ ...bind, trigger: 'Horizon' })
  assert.equal(rig.work.inspect().devopsId, 'devops')
})

test('SPEC[lifecycle-006] authority advance requires review, exact previous value and a never-used next value', () => {
  const rig = new Rig()
  rig.open()
  const command = { type: 'Advance', incumbencyId: rig.work.inspect().active.id, expected: rig.work.inspect().authority, next: 'next-authority' }
  assert.throws(() => rig.call(command), /advance/)
  rig.review()
  assert.throws(() => rig.call({ ...command, expected: 'wrong' }), /advance/)
  rig.apply(command)
  assert.equal(rig.work.inspect().authority, 'next-authority')
  assert.throws(() => rig.call({ ...command, expected: 'next-authority', next: command.expected }), /advance/)
  assert.throws(() => rig.call({ ...command, expected: 'next-authority' }), /advance/)
})

test('SPEC[lifecycle-006] reopening creates a new reviewed-by-nobody incumbency, not a resurrected owner', () => {
  const rig = new Rig()
  const { operationId } = rig.reserve()
  const oldId = rig.work.inspect().active.id
  const retired = rig.apply(rig.accepted(operationId))
  const closing = rig.work.history().at(-1).events[0].retirementCursor
  const reopen = { type: 'Reopen', retirementId: retired.retirementId, ownerId: 'new-manager', openingCursor: closing + 1, blockers: [] }
  assert.throws(() => rig.call({ ...reopen, blockers: ['old-provider-is-live'] }), /block/)
  rig.apply(reopen)
  const state = rig.work.inspect()
  assert.notEqual(state.active.id, oldId)
  assert.equal(state.active.ownerId, 'new-manager')
  assert.equal(state.active.reviewOutcome, null)
  assert.equal(state.canWriteSource, false)
  assert.equal(state.deliveryAuthorized, false)
  assert.deepEqual(rig.work.history().at(-1).events.map(event => event.type), ['Reopened', 'IncumbencyOpened'])
})

test('SPEC[lifecycle-006] retirement blockers are recorded observations, not dirty-workspace policy', () => {
  const rig = new Rig(['S4'])
  rig.open()
  rig.review(['Tests failed and the workspace is dirty.'])
  rig.deliver()
  const first = rig.deliver({ blockers: ['process', 'child', 'process'] })
  const second = rig.deliver({ blockers: ['child', 'process'] })
  assert.equal(first.kind, 'Blocked')
  assert.equal(first.blockerDigest, second.blockerDigest)
  assert.equal(rig.work.inspect().rounds.length, 0)
  assert.equal(rig.deliver({ blockers: [] }).kind, 'Relayed')
})

test('SPEC[lifecycle-006] all state-changing work commands stop behind a pending delivery', () => {
  const rig = new Rig()
  rig.reserve()
  const state = rig.work.inspect()
  const count = rig.count
  assert.throws(() => rig.call({ type: 'Advance', incumbencyId: state.active.id, expected: state.authority, next: 'next' }), /pending/)
  assert.throws(() => rig.call({ type: 'BindDevOps', incumbencyId: state.active.id, trigger: 'Ask', devopsId: 'devops', target: null }), /pending/)
  assert.equal(rig.count, count)
})
