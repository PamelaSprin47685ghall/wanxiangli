import test from 'node:test'
import assert from 'node:assert/strict'
import { Wait } from '../../../../dist/program/Program.js'
import { describe, owner, registry, externalProducer, workflowProducer, escape } from './support.mjs'

test('WHAT[CAUSAL-WAIT-002] the five diagnostic elements survive a snapshot round trip', () => {
  const runtime = registry()
  const descriptor = {
    waitKind: 'provider-attempt',
    owner: owner('manager', { run: 'r1', turn: 't2' }),
    subject: { channel: 'primary', attempt: '3' },
    producer: externalProducer('provider', { family: 'glm', run: 'r1' }),
    escapes: [escape('deadlineAt', '2026-10-15T00:00:10.000Z'), escape('cancelledBy', owner('user', { id: 'u9' })), escape('processLifetime')],
    source: 'test://causal-elements',
  }
  const lease = Wait.enter(runtime, descriptor)
  const active = Wait.snapshot(runtime).active

  assert.equal(active.length, 1)
  const observed = active[0]
  assert.equal(observed.waitKind, 'provider-attempt')
  assert.deepEqual(observed.owner, descriptor.owner)
  assert.deepEqual(observed.subject, descriptor.subject)
  assert.deepEqual(observed.producer, descriptor.producer)
  assert.equal(observed.escapes.length, 3)
  assert.equal(observed.escapes[0].kind, 'deadlineAt')
  assert.equal(observed.escapes[0].at, '2026-10-15T00:00:10.000Z')
  assert.equal(observed.escapes[1].kind, 'cancelledBy')
  assert.deepEqual(observed.escapes[1].owner, owner('user', { id: 'u9' }))
  assert.equal(observed.escapes[2].kind, 'processLifetime')
  assert.equal(observed.source, 'test://causal-elements')

  Wait.dispose(lease)
})

test('WHAT[CAUSAL-WAIT-002] termination records the responsible exit on the transition', () => {
  const runtime = registry()
  const lease = Wait.enter(runtime, describe())
  Wait.markExit(lease, 'WaitTimedOut')
  Wait.dispose(lease)

  const history = Wait.snapshot(runtime).history
  assert.equal(history.length, 2)
  assert.equal(history[0].kind, 'Entered')
  assert.equal(history[0].exit, null)
  assert.equal(history[1].kind, 'Left')
  assert.equal(history[1].exit, 'WaitTimedOut')
})

test('WHAT[CAUSAL-WAIT-002] owner identity is order-independent in the diagnostic key', () => {
  const one = Wait.ownerKey(owner('engineer', { id: 'a', run: 'r' }))
  const two = Wait.ownerKey(owner('engineer', { run: 'r', id: 'a' }))
  assert.equal(one, two)
  assert.equal(Wait.producerKey(workflowProducer(owner('engineer', { id: 'a', run: 'r' }))), 'workflow:' + one)
})
