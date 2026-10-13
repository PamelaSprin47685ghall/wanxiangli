import test from 'node:test'
import assert from 'node:assert/strict'
import { Ownership } from 'wanxiangli/ownership'
import { Rig, open, reserve, started, binding, unchanged } from './support.mjs'

test('SPEC[ownership-005] generated public objects expose messages, not mutable tables or physical handles', () => {
  const rig = new Rig()
  rig.open()
  rig.reserve()
  assert.deepEqual(Object.keys(rig.owner).sort(), ['blockers', 'execute', 'head', 'inspect', 'records', 'resource', 'scope'])
  const before = rig.owner.inspect()
  rig.owner.resources = new Map()
  rig.owner.scopes = new Map()
  assert.deepEqual(rig.owner.inspect(), before)
})

test('SPEC[ownership-005] input, lease, binding, receipt and views never alias internal state', () => {
  const rig = new Rig()
  const opening = open()
  rig.apply(opening)
  opening.scopeId = 'mutated'
  const lease = rig.reserve()
  const original = structuredClone(lease)
  const target = binding()
  rig.apply(started(lease, target))
  lease.token = 'rewritten'
  target.incarnationId = 'changed'
  const before = rig.owner.resource(original)
  const view = rig.owner.resource(original)
  view.binding.externalId = 'rewritten'
  view.lease.resourceId = 'rewritten'
  view.cancellationRequested = true
  rig.owner.blockers('work')[0].binding.incarnationId = 'rewritten'
  rig.owner.inspect().roots.push('phantom')
  rig.owner.scope('work').children.push('phantom')
  rig.owner.head().revision = 999
  assert.deepEqual(rig.owner.resource(original), before)
  const records = rig.owner.records()
  const restored = new Ownership('registry', records)
  records.fill('broken')
  assert.deepEqual(restored.records(), rig.owner.records())
})

test('SPEC[ownership-005] replayed result mutation cannot alter the saved receipt', () => {
  const rig = new Rig()
  rig.open()
  const first = rig.call(reserve(), 'reserve')
  const expected = structuredClone(first)
  first.result.lease.token = 'mutated'
  rig.call(reserve(), 'reserve').result.lease.registryId = 'mutated'
  assert.deepEqual(rig.call(reserve(), 'reserve'), { ...expected, status: 'Replayed' })
})

test('SPEC[ownership-005] same names in separate registries have separate leases and state', () => {
  const first = new Rig('first')
  const second = new Rig('second')
  first.open()
  second.open()
  const firstLease = first.reserve()
  const secondLease = second.reserve()
  assert.notEqual(firstLease.token, secondLease.token)
  unchanged(second.owner, () => second.apply(started(firstLease)), /Foreign/)
  unchanged(first.owner, () => first.owner.resource({ ...firstLease, token: secondLease.token }), /match/)
  first.apply({ type: 'Cancel', lease: firstLease })
  assert.equal(second.owner.resource(secondLease).cancellationRequested, false)
})

test('SPEC[ownership-005] input accessors are rejected without being invoked', () => {
  const rig = new Rig()
  let invoked = 0
  const value = { ...open(), get parentId() { invoked++; return null } }
  unchanged(rig.owner, () => rig.call(value), /accessor/)
  assert.equal(invoked, 0)
  rig.open()
  const lease = rig.reserve()
  const target = { externalId: 'container', get incarnationId() { invoked++; return 'instance' } }
  unchanged(rig.owner, () => rig.call(started(lease, target)), /accessor/)
  assert.equal(invoked, 0)
})

test('SPEC[ownership-005] synchronous proxy reentry cannot observe half-open scopes or add a competing message', () => {
  const rig = new Rig()
  let checked = false
  const input = new Proxy(open(), {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'type') {
        assert.throws(() => rig.owner.inspect(), /reentrant/)
        assert.throws(() => rig.call(open('intruder')), /reentrant/)
        checked = true
      }
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  rig.apply(input)
  assert.ok(checked)
  assert.deepEqual(rig.owner.inspect().roots, ['work'])
})

for (const value of ['', null, 1, 'x\u0000suffix', '\ud800', 'x'.repeat(1025)]) {
  test(`SPEC[ownership-005] invalid identifier ${JSON.stringify(value).slice(0, 30)} cannot change ownership`, () => {
    assert.throws(() => new Ownership(value))
    const rig = new Rig()
    unchanged(rig.owner, () => rig.call(open(value)))
    unchanged(rig.owner, () => rig.owner.execute(value, open()))
    rig.open()
    unchanged(rig.owner, () => rig.call(reserve(value)))
  })
}

test('SPEC[ownership-005] extra protocol fields and unsupported outcomes are rejected without widening the contract', () => {
  const rig = new Rig()
  for (const bad of [null, {}, { ...open(), capacity: 1 }, { ...open(), [Symbol('field')]: true }, { type: 'Transfer', scopeId: 'work' }]) unchanged(rig.owner, () => rig.call(bad))
  rig.open()
  unchanged(rig.owner, () => rig.call(reserve('res', 'work', 'unknown')), /choice/)
  const lease = rig.reserve()
  for (const reason of ['', null, 'x'.repeat(4097)]) unchanged(rig.owner, () => rig.call({ type: 'NotStarted', lease, reason }))
  unchanged(rig.owner, () => rig.call({ type: 'Ended', lease, binding: binding(), outcome: 'Unknown' }), /choice/)
})
