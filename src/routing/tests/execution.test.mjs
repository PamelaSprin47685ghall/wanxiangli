import test from 'node:test'
import assert from 'node:assert/strict'
import { ExecutionRouting } from '../../../dist/routing/RoutingProtocol.js'

const target = (model = 'provider/shared', reasoning = 'none') => ({ model, reasoning })
const request = (sessionId, physicalUserMessageId, role = 'worker', participant = 'person', rest = {}) =>
  ({ sessionId, physicalUserMessageId, role, participant, purpose: 'normal', ...rest })
const create = (scheduler = () => target(), binding) => new ExecutionRouting({ scheduler, binding })
const begin = (runtime, session, physical, role = 'worker', rest = {}) => runtime.acquire(request(session, physical, role, 'person', rest))
const settle = async outcome => outcome.kind === 'Queued' ? outcome.node.completion : outcome
async function acquire(runtime, session, physical, role = 'worker', rest = {}) {
  const result = await settle(await begin(runtime, session, physical, role, rest))
  assert.equal(result.kind, 'Admitted')
  assert.ok(['Applied', 'AlreadyApplied'].includes(runtime.commit(result.lease, result.lease.identity)))
  return result.lease
}
const enter = (runtime, session, physical, requestKey = null) => runtime.enterStep({ sessionId: session, physicalUserMessageId: physical, visibleProviderRuns: [], requestKey })
const release = (runtime, session, physical) => runtime.releasePhysical(session, physical)
async function fill(runtime, count = 32) {
  const pending = []
  for (let index = 0; index < count; index++) {
    const result = await begin(runtime, `waiting-${index}`, `physical-${index}`)
    assert.equal(result.kind, 'Queued')
    pending.push(result)
  }
  return pending
}
const cancelAll = runtime => {
  for (const waiter of runtime.snapshot().waiters) {
    if (waiter.kind === 'Admission') runtime.cancelPending(waiter.owner.sessionId)
  }
}

test('ExecutionRouting keeps the original permit on same-physical retries and read-only committed queries', async () => {
  const seen = []
  const runtime = create((_role, running, previous) => { seen.push({ running, previous }); return target() })
  const first = await begin(runtime, 'session', 'physical')
  assert.equal(first.kind, 'Admitted')
  assert.equal(runtime.tryRead('session', 'physical'), null)
  assert.equal((await begin(runtime, 'session', 'physical')).lease, first.lease)
  assert.equal(runtime.commit(first.lease, first.lease.identity), 'Applied')
  const before = runtime.snapshot()
  assert.equal(runtime.tryRead('session', 'physical'), first.lease)
  assert.equal(runtime.tryRead('missing', 'physical'), null)
  assert.equal(runtime.tryRead('', 'physical'), null)
  assert.equal(runtime.tryRead('session', ''), null)
  assert.equal(runtime.tryRead('session', 'other'), null)
  assert.deepEqual(runtime.snapshot(), before)
  const newer = await acquire(runtime, 'session', 'new-physical')
  assert.notEqual(newer, first.lease)
  assert.equal(runtime.tryRead('session', 'physical'), null)
  assert.equal(runtime.target(first.lease).rejection, 'StaleLease')
  assert.deepEqual(seen, [{ running: [], previous: null }, { running: [target()], previous: target() }])
  release(runtime, 'session', 'new-physical')
  assert.equal(runtime.tryRead('session', 'new-physical'), null)
})

test('ExecutionRouting rejects foreign permits and same-physical role or participant changes', async () => {
  const runtime = create()
  const first = await acquire(runtime, 'session', 'physical')
  assert.equal(create().target(first).rejection, 'WrongFence')
  await assert.rejects(begin(runtime, 'session', 'physical', 'other'), /changed role/)
  await assert.rejects(runtime.acquire(request('session', 'physical', 'worker', 'other')), /changed participant/)
  assert.equal(runtime.tryRead('session', 'physical'), first)
})

test('ExecutionRouting reservation adoption uses one scheduler decision and binds role and participant', async () => {
  let calls = 0
  const runtime = create(() => { calls++; return target() })
  assert.deepEqual(runtime.reserve({ sessionId: 'session', role: 'worker' }), target())
  assert.equal(runtime.tryRead('session', 'physical'), null)
  assert.equal(runtime.occupied().length, 1)
  const lease = await acquire(runtime, 'session', 'physical')
  assert.equal(calls, 1)
  assert.equal(runtime.occupied().length, 1)
  assert.deepEqual(runtime.tryLease(request('session', 'physical')), target())
  await assert.rejects(runtime.acquire(request('session', 'physical', 'worker', 'other')), /changed participant/)
  assert.equal(runtime.tryRead('session', 'physical'), lease)
  const second = create()
  second.reserve({ sessionId: 'session', role: 'worker' })
  await assert.rejects(begin(second, 'session', 'physical', 'other'), /changed role/)
  const unavailable = create(() => null)
  assert.equal(unavailable.reserve({ sessionId: 'session', role: 'worker' }), null)
  assert.equal(unavailable.pendingCount, 0)
  assert.deepEqual(unavailable.occupied(), [])
})

test('ExecutionRouting releases capacity to the oldest eligible waiter and skips an ineligible head', async () => {
  let enabled = false
  const runtime = create((role, running) => {
    if (role === 'trigger') return target('other/trigger')
    if (role === 'ready' && enabled && !running.some(item => item.model === 'provider/shared')) return target()
    return null
  })
  const blocked = await begin(runtime, 'blocked', 'blocked', 'blocked')
  const first = await begin(runtime, 'first', 'first', 'ready')
  const second = await begin(runtime, 'second', 'second', 'ready')
  const repeat = await begin(runtime, 'first', 'first', 'ready')
  assert.equal(repeat.node, first.node)
  assert.equal(repeat.node.completion, first.node.completion)
  enabled = true
  await acquire(runtime, 'trigger', 'trigger', 'trigger')
  const acquired = await first.node.completion
  assert.equal(acquired.kind, 'Admitted')
  assert.equal(runtime.pendingCount, 2)
  assert.equal(runtime.commit(acquired.lease, acquired.lease.identity), 'Applied')
  assert.deepEqual(release(runtime, 'first', 'first'), { kind: 'Released', outcome: 'Applied' })
  assert.equal((await second.node.completion).kind, 'Admitted')
  assert.equal(runtime.pendingCount, 1)
  runtime.cancelPending('blocked')
  assert.equal((await blocked.node.completion).kind, 'Cancelled')
})

test('ExecutionRouting supersedes one queued generation and cancellation is exact and idempotent', async () => {
  const runtime = create(role => role === 'ready' ? target() : null)
  const first = await begin(runtime, 'same', 'old')
  const second = await begin(runtime, 'same', 'new')
  assert.equal((await first.node.completion).kind, 'Superseded')
  assert.equal(runtime.cancelPendingPhysical('same', 'old'), 'StaleFence')
  assert.equal(runtime.pendingCount, 1)
  assert.equal(runtime.cancelPendingPhysical('same', 'new'), 'Applied')
  assert.equal((await second.node.completion).kind, 'Cancelled')
  assert.equal(runtime.cancelPending('same'), 'AlreadyApplied')
  const waiting = await begin(runtime, 'same', 'waiting')
  await acquire(runtime, 'same', 'ready', 'ready')
  assert.equal((await waiting.node.completion).kind, 'Superseded')
  assert.equal(runtime.pendingCount, 0)
})

test('ExecutionRouting full queue preserves the old active execution but allows an immediately available fresh one', async () => {
  const runtime = create(role => role === 'ready' ? target() : null)
  const old = await acquire(runtime, 'active', 'old', 'ready')
  const waiting = await fill(runtime)
  const before = runtime.snapshot()
  assert.deepEqual(await begin(runtime, 'overflow', 'overflow'), { kind: 'QueueFull' })
  assert.deepEqual(await begin(runtime, 'active', 'new'), { kind: 'QueueFull' })
  assert.equal(runtime.tryRead('active', 'old'), old)
  assert.deepEqual(runtime.snapshot(), before)
  await acquire(runtime, 'fresh', 'fresh', 'ready')
  assert.equal(runtime.pendingCount, 32)
  assert.equal(runtime.occupied().length, 2)
  cancelAll(runtime)
  assert.ok((await Promise.all(waiting.map(item => item.node.completion))).every(item => item.kind === 'Cancelled'))
})

test('ExecutionRouting repeated and stale physical release cannot remove a current owner', async () => {
  const runtime = create((_role, running) => running.length < 1 ? target() : null)
  await acquire(runtime, 'holder', 'holder')
  const waiting = await begin(runtime, 'waiter', 'waiter')
  assert.deepEqual(release(runtime, 'holder', 'holder'), { kind: 'Released', outcome: 'Applied' })
  const next = await waiting.node.completion
  assert.equal(next.kind, 'Admitted')
  runtime.commit(next.lease, next.lease.identity)
  assert.deepEqual(release(runtime, 'holder', 'holder'), { kind: 'Released', outcome: 'AlreadyApplied' })
  assert.equal(runtime.tryRead('waiter', 'waiter'), next.lease)
  const newer = await acquire(runtime, 'waiter', 'newer')
  const before = runtime.snapshot()
  assert.deepEqual(release(runtime, 'waiter', 'waiter'), { kind: 'Released', outcome: 'StaleFence' })
  assert.equal(runtime.tryRead('waiter', 'newer'), newer)
  assert.deepEqual(runtime.snapshot().tokens, before.tokens)
})

for (const borrowed of [false, true]) {
  for (const completed of [false, true]) {
    test(`ExecutionRouting transfers ${borrowed ? 'borrowed' : 'owned'} credit ${completed ? 'after terminal output' : 'after a tool step'} and preserves newer steps`, async () => {
      let changed = false
      const runtime = create(() => target(changed ? 'other/new' : 'provider/shared'))
      if (borrowed) await acquire(runtime, 'lender', 'lender', 'owner')
      const old = await acquire(runtime, 'child', 'old', 'worker', { lenderSessionId: borrowed ? 'lender' : null })
      await enter(runtime, 'child', 'old')
      assert.deepEqual(runtime.retainInput(old, 'guidance'), target())
      runtime.retainInput(old, 'later-guidance')
      runtime.endStep('child', 'old', 'old-run')
      if (completed) assert.deepEqual(release(runtime, 'child', 'old'), { kind: 'HeldForInput' })
      const credit = runtime.snapshot().tokens[0].credit
      changed = true
      const next = await runtime.continue(old, 'guidance')
      assert.equal(next.kind, 'Admitted')
      assert.deepEqual(runtime.target(next.lease).value, target())
      assert.equal(runtime.tryInput('child', 'guidance'), null)
      assert.equal(runtime.tryInput('child', 'later-guidance'), next.lease)
      assert.equal(runtime.commit(next.lease, next.lease.identity), 'Applied')
      await enter(runtime, 'child', 'guidance')
      const running = runtime.snapshot()
      assert.equal(running.activeCount, 1)
      assert.equal(running.tokens.length, 1)
      assert.equal(running.tokens[0].credit, credit)
      assert.equal(running.tokens[0].owner.sessionId, borrowed ? 'lender' : 'child')
      assert.equal(running.custodies.some(item => item.credit === credit && item.owner.sessionId === 'child' && item.owner.physicalUserMessageId === 'guidance'), true)
      runtime.endStep('child', 'old', 'old-run')
      runtime.releaseBeforeProvider(old, old.identity)
      await assert.rejects(runtime.continue(old, 'stale-guidance'), /no longer owns/)
      assert.deepEqual(runtime.snapshot().tokens, running.tokens)
      runtime.cancelInput('child', 'later-guidance')
      runtime.endStep('child', 'guidance', 'new-run')
      release(runtime, 'child', 'guidance')
      if (borrowed) release(runtime, 'lender', 'lender')
      assert.deepEqual(runtime.occupied(), [])
    })
  }
  test(`ExecutionRouting cancellation returns held ${borrowed ? 'borrowed' : 'owned'} credit after its final retained input`, async () => {
    const runtime = create()
    if (borrowed) await acquire(runtime, 'lender', 'lender', 'owner')
    const old = await acquire(runtime, 'child', 'old', 'worker', { lenderSessionId: borrowed ? 'lender' : null })
    runtime.retainInput(old, 'guidance')
    runtime.retainInput(old, 'second')
    assert.deepEqual(release(runtime, 'child', 'old'), { kind: 'HeldForInput' })
    runtime.cancelInput('child', 'guidance')
    assert.equal(runtime.holdsPhysical('child', 'old'), true)
    runtime.cancelSessionInputs('child')
    assert.equal(runtime.tryInput('child', 'second'), null)
    assert.equal(runtime.snapshot().tokens.length, borrowed ? 1 : 0)
    assert.equal(runtime.snapshot().executions.some(item => item.sessionId === 'child'), false)
    if (borrowed) {
      await enter(runtime, 'lender', 'lender')
      assert.equal(runtime.snapshot().activeCount, 1)
      runtime.endStep('lender', 'lender', 'lender-run')
      release(runtime, 'lender', 'lender')
    }
    assert.deepEqual(runtime.occupied(), [])
  })
}

test('ExecutionRouting has exact step caching and latest single-consumption run observations', async () => {
  let sequence = 0
  const runtime = create(() => target(`provider/model-${++sequence}`))
  await acquire(runtime, 'session', 'first')
  const first = enter(runtime, 'session', 'first', 'request')
  assert.equal(enter(runtime, 'session', 'first', 'request'), first)
  await first
  runtime.rememberStep('session', 'first', 'observed-run')
  assert.deepEqual(runtime.stepOf('observed-run'), { sessionId: 'session', physicalUserMessageId: 'first' })
  assert.equal(runtime.stepOf('unknown'), null)
  runtime.endStep('session', 'first', 'first-run')
  const nextStep = enter(runtime, 'session', 'first', 'request')
  assert.notEqual(nextStep, first)
  await nextStep
  runtime.suppressStep('session', 'first')
  const newer = await acquire(runtime, 'session', 'second')
  assert.equal(runtime.wasSuperseded('session', 'first'), true)
  assert.equal(runtime.wasStoppedSuperseded('session', 'first'), true)
  runtime.endStep('session', 'second', 'second-run')
  assert.equal(runtime.takeRunTarget('first-run'), null)
  assert.deepEqual(runtime.takeRunTarget('second-run'), newer.identity.target)
  assert.equal(runtime.takeRunTarget('second-run'), null)
  release(runtime, 'session', 'second')
  assert.equal(runtime.stepOf('second-run'), null)
})

test('ExecutionRouting does not inherit targets from released or unrelated sessions', async () => {
  const previous = []
  let sequence = 0
  const runtime = create((_role, _running, prior) => { previous.push(prior); return prior ?? target(`provider/model-${++sequence}`) })
  const first = await acquire(runtime, 'first', 'old')
  const second = await acquire(runtime, 'other', 'other')
  assert.notDeepEqual(second.identity.target, first.identity.target)
  release(runtime, 'first', 'old')
  const fresh = await acquire(runtime, 'first', 'fresh')
  assert.notDeepEqual(fresh.identity.target, first.identity.target)
  assert.deepEqual(previous, [null, null, null])
})

test('ExecutionRouting preserves committed admission when theoretical capacity changes', async () => {
  let available = true
  const policy = () => available ? target() : null
  policy.hasTheoreticalCapacity = () => available
  const runtime = create(policy)
  const old = await acquire(runtime, 'session', 'physical')
  available = false
  assert.equal((await begin(runtime, 'session', 'physical')).lease, old)
  assert.deepEqual(await begin(runtime, 'session', 'new'), { kind: 'QueueFull' })
  assert.equal(runtime.tryRead('session', 'physical'), old)
  await assert.rejects(runtime.acquire(request('session', 'physical', 'worker', 'other')), /participant/)
})

test('ExecutionRouting rejects only saturated waiting roles and resumes a released selected target', async () => {
  let available = true
  const policy = (role, running) => role === 'worker' && available && running.length === 0 ? target() : null
  policy.hasTheoreticalCapacity = role => role !== 'worker' || available
  const runtime = create(policy)
  await acquire(runtime, 'holder', 'holder')
  const waiting = await begin(runtime, 'waiting', 'waiting')
  const other = await begin(runtime, 'other', 'other', 'other')
  available = false
  release(runtime, 'holder', 'holder')
  assert.deepEqual(await waiting.node.completion, { kind: 'QueueFull' })
  assert.equal(runtime.pendingCount, 1)
  runtime.cancelPending('other')
  assert.equal((await other.node.completion).kind, 'Cancelled')
  available = true
  await acquire(runtime, 'holder', 'next-holder')
  const retry = await begin(runtime, 'retry', 'retry')
  release(runtime, 'holder', 'next-holder')
  assert.deepEqual(runtime.target((await retry.node.completion).lease).value, target())
})

test('ExecutionRouting poisons pending and future requests with the same policy exception', async () => {
  const error = new Error('broken policy')
  const runtime = create(role => { if (role === 'waiting') return null; throw error })
  const waiting = await begin(runtime, 'waiting', 'waiting', 'waiting')
  const settled = assert.rejects(waiting.node.completion, value => value === error)
  await assert.rejects(begin(runtime, 'trigger', 'trigger'), value => value === error)
  await settled
  await assert.rejects(begin(runtime, 'future', 'future', 'waiting'), value => value === error)
  assert.equal(runtime.pendingCount, 0)
})

test('ExecutionRouting rejects invalid policies and async capacity queries without queueing', async () => {
  for (const policy of [42, async () => target(), () => ({ model: 'bare', reasoning: 'none' }), () => target('provider/model', '')]) {
    const runtime = create(policy)
    await assert.rejects(begin(runtime, 'session', 'physical'), /function|synchronous|Promise|provider\/model|reasoning/)
    assert.equal(runtime.pendingCount, 0)
  }
  const policy = () => null
  policy.hasTheoreticalCapacity = async () => false
  const runtime = create(policy)
  await assert.rejects(begin(runtime, 'first', 'first'), /hasTheoreticalCapacity must be synchronous/)
  await assert.rejects(begin(runtime, 'later', 'later'), /hasTheoreticalCapacity must be synchronous/)
  assert.equal(runtime.pendingCount, 0)
})

test('ExecutionRouting calls policy with three arguments, capacity query with one, and retains duplicate occupancy', async () => {
  const calls = []
  const policy = (...args) => { calls.push(args); return args[2] ?? target() }
  policy.hasTheoreticalCapacity = (...args) => { calls.push(args); return true }
  const runtime = create(policy)
  await acquire(runtime, 'first', 'first')
  await acquire(runtime, 'second', 'second')
  await acquire(runtime, 'first', 'newer')
  assert.deepEqual(calls.filter(args => args.length === 1), [['worker'], ['worker'], ['worker']])
  const routed = calls.filter(args => args.length !== 1)
  assert.ok(routed.every(args => args.length === 3))
  assert.deepEqual(routed.at(-1), ['worker', [target(), target()], target()])
})

test('ExecutionRouting recomputes a queue after replacing the occupied generation in the same turn', async () => {
  const counts = []
  const runtime = create((_role, running) => { counts.push(running.length); return running.length < 1 ? target() : null })
  await acquire(runtime, 'session', 'old')
  runtime.endStep('session', 'old', 'old-run')
  const next = await acquire(runtime, 'session', 'next')
  assert.deepEqual(next.identity.target, target())
  assert.equal(runtime.pendingCount, 0)
  assert.equal(runtime.occupied().length, 1)
  assert.deepEqual(counts, [0, 1, 0])
})

const fixedPolicy = (read = () => null) => ({
  applies: role => role === 'fixed',
  read,
  error: ({ kind, bound, target }) => new Error(kind === 'durable'
    ? 'durable binding is immutable'
    : `binding is immutable (${bound.model}/${bound.reasoning} vs ${target.model}/${target.reasoning})`),
})

test('ExecutionRouting fixed bindings reject conflicting seeds and commits without changing their target', async () => {
  const runtime = create(() => target('provider/fixed', 'high'), fixedPolicy())
  runtime.seedBoundTarget('session', 'provider/fixed:high')
  for (const physical of ['first', 'second']) {
    const lease = await acquire(runtime, 'session', physical, 'fixed')
    assert.deepEqual(lease.identity.target, target('provider/fixed', 'high'))
    assert.throws(() => runtime.seedBoundTarget('session', 'other/changed:none'), /immutable/)
    assert.throws(() => runtime.commit(lease, { ...lease.identity, target: target('other/changed') }), /immutable/)
    assert.deepEqual(runtime.boundTarget('session'), target('provider/fixed', 'high'))
    release(runtime, 'session', physical)
  }
})

test('ExecutionRouting ordinary unbound sessions follow the scheduler without creating a fixed binding', async () => {
  let selected = target('provider/first')
  let calls = 0
  const runtime = create(() => { calls++; return selected }, fixedPolicy())
  const first = await acquire(runtime, 'session', 'first', 'fixed')
  assert.deepEqual(first.identity.target, selected)
  assert.equal(runtime.boundTarget('session'), null)
  release(runtime, 'session', 'first')
  selected = target('other/changed')
  const second = await acquire(runtime, 'session', 'second', 'fixed')
  assert.deepEqual(second.identity.target, selected)
  assert.equal(calls, 2)
  assert.equal(runtime.boundTarget('session'), null)
})

test('ExecutionRouting cold binding reads are role-limited and cached while drop only removes that cache', async () => {
  const reads = []
  const runtime = create((_role, _running, previous) => previous ?? target('other/unbound'), fixedPolicy(session => {
    reads.push(session)
    return 'provider/fixed:high'
  }))
  await acquire(runtime, 'ordinary', 'ordinary')
  assert.deepEqual(reads, [])
  const bound = await acquire(runtime, 'fixed', 'first', 'fixed')
  assert.deepEqual(bound.identity.target, target('provider/fixed', 'high'))
  assert.deepEqual(reads, ['fixed'])
  runtime.dropSession('fixed')
  assert.equal(runtime.boundTarget('fixed'), null)
  assert.equal(runtime.tryRead('fixed', 'first'), bound)
  assert.equal(runtime.occupied().length, 2)
  release(runtime, 'fixed', 'first')
  runtime.setBoundReader(() => 'provider/reloaded:low')
  const next = await acquire(runtime, 'fixed', 'next', 'fixed')
  assert.deepEqual(next.identity.target, target('provider/reloaded', 'low'))
})

test('ExecutionRouting waits when a scheduler changes away from the bound target', async () => {
  let selected = target('provider/fixed')
  const runtime = create(() => selected, fixedPolicy())
  runtime.seedBoundTarget('session', 'provider/fixed:none')
  await acquire(runtime, 'session', 'first', 'fixed')
  release(runtime, 'session', 'first')
  selected = target('other/changed')
  const waiting = await begin(runtime, 'session', 'next', 'fixed')
  assert.equal(waiting.kind, 'Queued')
  assert.deepEqual(runtime.boundTarget('session'), target('provider/fixed'))
  runtime.cancelPending('session')
  assert.equal((await waiting.node.completion).kind, 'Cancelled')
})

test('ExecutionRouting durable target parsing, repeat seeding and instance isolation use the existing protocol', () => {
  const first = create(undefined, fixedPolicy())
  const second = create(undefined, fixedPolicy())
  first.seedBoundTarget('session', 'provider/model:variant:high')
  first.seedBoundTarget('session', 'provider/model:variant:high')
  assert.deepEqual(first.boundTarget('session'), target('provider/model:variant', 'high'))
  assert.equal(second.boundTarget('session'), null)
  second.seedBoundTarget('session', 'other/target:low')
  assert.deepEqual(first.boundTarget('session'), target('provider/model:variant', 'high'))
  for (const value of ['', 'provider/model', 'bare:high', 'provider/model:']) {
    assert.throws(() => first.seedBoundTarget('invalid', value), /durable|provider\/model|reasoning/)
    assert.equal(first.boundTarget('invalid'), null)
  }
})

test('ExecutionRouting null scheduler preserves host selection without cold binding reads or enforcement', async () => {
  const runtime = create(null, fixedPolicy(() => { throw new Error('must not read') }))
  runtime.seedBoundTarget('session', 'provider/fixed:high')
  const lease = await acquire(runtime, 'session', 'first', 'fixed', { hostTarget: target('host/selected') })
  assert.deepEqual(lease.identity.target, target('host/selected'))
  assert.equal((await begin(runtime, 'session', 'first', 'fixed', { hostTarget: target('other/changed') })).lease, lease)
  assert.deepEqual(runtime.boundTarget('session'), target('provider/fixed', 'high'))
})
