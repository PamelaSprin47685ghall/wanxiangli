import test from 'node:test'
import assert from 'node:assert/strict'

import { CapacityBorrowing } from 'wanxiangli/borrowing'

const t = (model, reasoning = 'none') => ({ model, reasoning })
const options = {
  providerOf: target => target.model.slice(0, target.model.indexOf('/')),
  sameTarget: (a, b) => a.model === b.model && a.reasoning === b.reasoning,
}
const limit = (n, target) => running => (running.length < n ? target : null)
const settled = async promise => {
  let state = 'pending'
  promise.then(() => { state = 'resolved' }, error => { state = 'rejected:' + error.constructor.name })
  await new Promise(resolve => setImmediate(resolve))
  return state
}

test('SPEC[borrowing-1] fresh route acquires one token; a newer physical takes over the owned token', () => {
  const capacity = new CapacityBorrowing(options)
  const a = t('p/a')
  assert.equal(capacity.routeFresh('s1', null, 'm1', null, limit(2, a)), a)
  assert.deepEqual(capacity.snapshot(), [a])
  assert.equal(capacity.exactCredit('s1', 'm1'), 1)
  const b = t('p/b')
  assert.equal(capacity.routeFresh('s1', 'm1', 'm2', null, limit(2, b)), b)
  assert.deepEqual(capacity.snapshot(), [b], 'the old execution token is retired, a new one is acquired')
  assert.equal(capacity.exactCredit('s1', 'm2'), 2)
  assert.throws(() => capacity.exactCredit('s1', 'm1'), /no exact capacity credit/)
  assert.equal(capacity.routeFresh('s2', null, 'm1', null, limit(1, a)), null, 'running is full')
  assert.equal(capacity.releasePhysical('s1', 'm2'), 'Applied')
  assert.equal(capacity.releasePhysical('s1', 'm2'), 'AlreadyApplied')
  assert.deepEqual(capacity.snapshot(), [])
  assert.throws(() => new CapacityBorrowing({}), /providerOf/)
})

test('SPEC[borrowing-2] a child borrows the lender idle token of the same provider without adding a token', async () => {
  const capacity = new CapacityBorrowing(options)
  const a = t('p/a')
  capacity.routeFresh('parent', null, 'm1', null, limit(1, a))
  assert.equal(capacity.routeFresh('child', null, 'c1', 'parent', limit(1, a)), a)
  assert.equal(capacity.snapshot().length, 1, 'borrowing never adds a token')
  assert.equal(capacity.exactCredit('child', 'c1'), capacity.exactCredit('parent', 'm1'))
  const step = capacity.enterStep('child', 'c1', a, ['run-1'], () => false, 'k1')
  assert.equal(await settled(step), 'resolved')
  assert.equal(capacity.invariantSnapshot().inFlightCount, 1)
  const parentStep = capacity.enterStep('parent', 'm1', a, ['run-0'], () => false, 'k0')
  assert.equal(await settled(parentStep), 'resolved', 'the owner reclaims its token from the descendant borrow on re-entry')
  const again = capacity.enterStep('parent', 'm1', a, ['run-0'], () => false, 'k0')
  assert.equal(await settled(again), 'resolved', 'same requestKey and fence reuses the in-flight step')
  assert.equal(capacity.invariantSnapshot().waiters.length, 0)
})

test('SPEC[borrowing-2] provider steps queue by arrival, are cancelled by release and bounded', async () => {
  const capacity = new CapacityBorrowing(options)
  const a = t('p/a')
  capacity.routeFresh('s1', null, 'm1', null, limit(1, a))
  const first = capacity.enterStep('s1', 'm1', a, ['r1'], () => false, 'k1')
  assert.equal(await settled(first), 'resolved')
  const second = capacity.enterStep('s1', 'm1', a, ['r1'], () => false, 'k2')
  assert.equal(await settled(second), 'pending', 'the only token is in flight')
  assert.equal(capacity.invariantSnapshot().waiters[0].kind, 'ProviderStep')
  capacity.endStep('s1', 'm1', 'r2')
  assert.equal(await settled(second), 'resolved', 'ending the step grants the waiter')
  const third = capacity.enterStep('s1', 'm1', a, ['r1'], () => false, 'k3')
  assert.equal(capacity.releaseSession('s1'), 'Applied')
  assert.match(await settled(third), /^rejected:/)
  assert.equal(capacity.releaseSession('s1'), 'AlreadyApplied')
  const busy = new CapacityBorrowing(options)
  busy.routeFresh('x', null, 'm', null, limit(1, a))
  await busy.enterStep('x', 'm', a, ['r'], () => false, 'k')
  const waiting = []
  for (let i = 0; i < 32; i++) waiting.push(busy.enterStep('x', 'm', a, ['r'], () => false, 'w' + i))
  await assert.rejects(busy.enterStep('x', 'm', a, ['r'], () => false, 'overflow'), /provider-step capacity queue full/)
  busy.fail(new Error('down'))
  for (const w of waiting) await assert.rejects(w, /down/)
})

test('SPEC[borrowing-3] retiring an in-flight token waits for the step to end; continuation moves custody', async () => {
  const capacity = new CapacityBorrowing(options)
  const a = t('p/a')
  capacity.routeFresh('s1', null, 'm1', null, limit(3, a))
  await capacity.enterStep('s1', 'm1', a, ['r1'], () => false, 'k1')
  assert.equal(capacity.continueExecution('s1', 'm1', 'm2', a), a)
  assert.throws(() => capacity.continueExecution('s1', 'm1', 'm3', a), /no previous capacity/)
  capacity.routeFresh('s2', null, 'n1', null, limit(3, a))
  await capacity.enterStep('s2', 'n1', a, ['q1'], () => false, 'k')
  capacity.releasePhysical('s2', 'n1')
  const snap = capacity.invariantSnapshot()
  assert.equal(snap.retiringCount, 1, 'the in-flight token is retiring, still counted in running')
  assert.equal(capacity.snapshot().length, 2)
  capacity.suppressStep('s2', 'n1')
  assert.equal(capacity.snapshot().length, 1, 'the retiring token is returned when its step ends')
  assert.equal(capacity.reserveFresh('s3', null, limit(3, a)), a)
  capacity.adoptReservation('s3', 'z1', a)
  assert.equal(capacity.exactCredit('s3', 'z1'), 3)
  assert.deepEqual(capacity.invariantSnapshot().custodies.map(c => [c.credit, c.owner.sessionId, c.owner.physicalUserMessageId]), [[1, 's1', 'm2'], [3, 's3', 'z1']])
})
