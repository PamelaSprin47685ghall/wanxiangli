import assert from 'node:assert/strict'
import test from 'node:test'
import { BookkeeperStaging, BookkeeperLedger, BookkeeperTransaction } from 'wanxiangli/casebook'

const ok = value => ({ ok: true, value })
const error = error => ({ ok: false, error })
const ack = { ok: true }
const physical = outcome => outcome.ok ? { tag: 0, fields: [undefined] } : { tag: 1, fields: [outcome.error] }
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function fixture(t) {
  const staging = new BookkeeperStaging()
  const ledger = new BookkeeperLedger()
  const transaction = new BookkeeperTransaction(staging, ledger)
  const request = { txId: 'tx', ownerId: 'owner', question: 'Q', answer: 'A' }
  const childId = 'child'
  const calls = []
  let complete
  const effects = {
    async open() {
      calls.push('open')
      assert.deepEqual(staging.snapshot('tx').fields[0], ['Q', 'A'])
      return ok(childId)
    },
    subscribe(child, callback) {
      calls.push('subscribe')
      assert.equal(child, childId)
      assert.equal(ledger.txIdFor(child), request.txId)
      complete = callback
      return () => calls.push('dispose')
    },
    prepare(child) {
      calls.push('prepare')
      assert.equal(ledger.isAttached(child), true)
      return ok({ agent: 'agent', text: 'prompt bytes' })
    },
    async send(child, agent, text) {
      calls.push('send')
      assert.equal(ledger.tryConsume(child, agent, text), true)
      staging.apply('tx', 'new Q', 'new A')
      complete(ack)
      return ack
    },
    async abort(child) {
      calls.push('abort')
      assert.equal(ledger.isAttached(child), true)
      assert.equal(staging.snapshot('tx').tag, 1)
      return ack
    },
  }
  t.after(() => { staging.abort('tx'); ledger.clear() })
  return { staging, ledger, transaction, request, childId, calls, effects, complete: outcome => complete(outcome) }
}

test('one transaction stages, binds, prepares, authorizes and retires before returning the written pair', async t => {
  const f = fixture(t)
  assert.deepEqual(await f.transaction.run(f.request, f.effects), ok({ question: 'new Q', answer: 'new A' }))
  assert.deepEqual(f.calls, ['open', 'subscribe', 'prepare', 'send', 'dispose', 'abort'])
  assert.equal(f.ledger.isAttached('child'), false)
  assert.equal(f.ledger.completePhysical('child', physical(ack)), false)
})

test('a synchronous terminal subscription is retained and a zero-setter edit still counts as written', async t => {
  const f = fixture(t)
  f.effects.subscribe = (child, complete) => {
    f.calls.push('subscribe')
    assert.equal(f.ledger.isAttached(child), true)
    const edit = f.staging.edit('tx', key => key).fields[0]
    assert.equal(edit.commit().tag, 0)
    complete(ack)
    return () => f.calls.push('dispose')
  }
  f.effects.send = async () => { f.calls.push('send'); return ack }
  assert.deepEqual(await f.transaction.run(f.request, f.effects), ok({ question: 'Q', answer: 'A' }))
  assert.deepEqual(f.calls, ['open', 'subscribe', 'prepare', 'send', 'dispose', 'abort'])
})

test('an open Result error removes staging without binding or aborting a child', async t => {
  const f = fixture(t)
  f.effects.open = async () => { f.calls.push('open'); return error('open failed') }
  assert.deepEqual(await f.transaction.run(f.request, f.effects), error('open failed'))
  assert.deepEqual(f.calls, ['open'])
  assert.equal(f.staging.snapshot('tx').tag, 1)
  assert.equal(f.ledger.isAttached('child'), false)
})

test('prepare failure disposes, aborts staging, waits for child abort and then unbinds', async t => {
  const f = fixture(t)
  const began = deferred()
  const released = deferred()
  f.effects.prepare = () => { f.calls.push('prepare'); return error('owner changed') }
  f.effects.abort = async child => {
    f.calls.push('abort')
    assert.equal(f.ledger.isAttached(child), true)
    assert.equal(f.staging.snapshot('tx').tag, 1)
    began.resolve()
    await released.promise
    return error('abort rejected as Result')
  }
  let settled = false
  const pending = f.transaction.run(f.request, f.effects).then(result => { settled = true; return result })
  await began.promise
  assert.equal(settled, false)
  assert.equal(f.ledger.isAttached('child'), true)
  released.resolve()
  assert.deepEqual(await pending, error('owner changed'))
  assert.equal(f.ledger.isAttached('child'), false)
  assert.deepEqual(f.calls, ['open', 'subscribe', 'prepare', 'dispose', 'abort'])
})

test('send Result failure wins over an early successful terminal', async t => {
  const f = fixture(t)
  f.effects.send = async () => {
    f.calls.push('send')
    f.staging.apply('tx', 'early Q', 'early A')
    f.complete(ack)
    return error('send failed after terminal')
  }
  assert.deepEqual(await f.transaction.run(f.request, f.effects), error('send failed after terminal'))
  assert.deepEqual(f.calls, ['open', 'subscribe', 'prepare', 'send', 'dispose', 'abort'])
  assert.equal(f.staging.snapshot('tx').tag, 1)
})

test('terminal failure and unwritten success keep their original errors and retire the child', async t => {
  for (const [outcome, expected] of [[error('terminal failed'), 'terminal failed'], [ack, 'bookkeeper program did not write the staged case']]) {
    const f = fixture(t)
    f.effects.send = async () => { f.complete(outcome); return ack }
    assert.deepEqual(await f.transaction.run(f.request, f.effects), error(expected))
    assert.equal(f.ledger.isAttached('child'), false)
    assert.equal(f.staging.snapshot('tx').tag, 1)
    assert.deepEqual(f.calls.slice(-2), ['dispose', 'abort'])
  }
})

test('success waits for retire and an Abort rejection is swallowed before unbind', async t => {
  const f = fixture(t)
  const began = deferred()
  const released = deferred()
  f.effects.abort = async child => {
    f.calls.push('abort')
    assert.equal(f.ledger.isAttached(child), true)
    assert.equal(f.staging.snapshot('tx').tag, 1)
    began.resolve()
    await released.promise
    throw new Error('abort promise rejected')
  }
  let settled = false
  const pending = f.transaction.run(f.request, f.effects).then(result => { settled = true; return result })
  await began.promise
  assert.equal(settled, false)
  assert.equal(f.ledger.isAttached('child'), true)
  released.resolve()
  assert.deepEqual(await pending, ok({ question: 'new Q', answer: 'new A' }))
  assert.equal(f.ledger.isAttached('child'), false)
})

test('direct and physical terminals share the original completion and ignore duplicate results', async t => {
  const f = fixture(t)
  f.effects.send = async child => {
    f.staging.apply('tx', 'first Q', 'first A')
    f.complete(ack)
    f.complete(error('late direct'))
    assert.equal(f.ledger.completePhysical(child, physical(error('late physical'))), true)
    assert.equal(f.ledger.completePhysical(child, physical(ack)), false)
    return ack
  }
  assert.deepEqual(await f.transaction.run(f.request, f.effects), ok({ question: 'first Q', answer: 'first A' }))
  assert.equal(f.calls.filter(call => call === 'dispose').length, 1)
  assert.equal(f.calls.filter(call => call === 'abort').length, 1)
})

test('ledger reset, unbind and rebind still cancel the same waiting transaction through Fable Result', async t => {
  const actions = [
    [ledger => ledger.clear(), 'bookkeeper runtime reset'],
    [ledger => ledger.unbind('child'), 'bookkeeper session retired before completion'],
    [ledger => ledger.bind('child', 'other tx', 'other owner'), 'bookkeeper session re-bound to new transaction'],
  ]
  for (const [action, reason] of actions) {
    const f = fixture(t)
    f.effects.send = async () => { action(f.ledger); return ack }
    f.effects.abort = async () => { f.calls.push('abort'); return ack }
    assert.deepEqual(await f.transaction.run(f.request, f.effects), error(reason))
    assert.equal(f.staging.snapshot('tx').tag, 1)
    assert.equal(f.ledger.isAttached('child'), false)
    assert.equal(f.calls.filter(call => call === 'abort').length, 1)
  }
})

test('open Promise rejection retains staging and does not become a Result error', async t => {
  const f = fixture(t)
  const rejection = new Error('open promise rejected')
  f.effects.open = async () => { throw rejection }
  await assert.rejects(f.transaction.run(f.request, f.effects), cause => cause === rejection)
  assert.deepEqual(f.staging.snapshot('tx').fields[0], ['Q', 'A'])
  assert.equal(f.ledger.isAttached('child'), false)
  assert.deepEqual(f.calls, [])
})

test('subscribe, prepare and send exceptions keep the original absence of automatic cleanup', async t => {
  for (const phase of ['subscribe', 'prepare', 'send']) {
    const f = fixture(t)
    const rejection = new Error(`${phase} rejected`)
    f.effects[phase] = () => { f.calls.push(phase); throw rejection }
    await assert.rejects(f.transaction.run(f.request, f.effects), cause => cause === rejection)
    assert.deepEqual(f.staging.snapshot('tx').fields[0], ['Q', 'A'])
    assert.equal(f.ledger.isAttached('child'), true)
    assert.equal(f.ledger.completePhysical('child', physical(error('cleanup'))), true)
    assert.equal(f.calls.includes('dispose'), false)
    assert.equal(f.calls.includes('abort'), false)
  }
  const f = fixture(t)
  const rejection = new Error('send promise rejected')
  f.effects.send = () => Promise.reject(rejection)
  await assert.rejects(f.transaction.run(f.request, f.effects), cause => cause === rejection)
  assert.equal(f.ledger.isAttached('child'), true)
  assert.equal(f.staging.snapshot('tx').tag, 0)
  assert.equal(f.calls.includes('dispose'), false)
})

test('Dispose throws before removeCompletion, staging abort or retire', async t => {
  const f = fixture(t)
  const rejection = new Error('dispose failed')
  f.effects.subscribe = (_child, complete) => {
    f.staging.apply('tx', 'written Q', 'written A')
    complete(ack)
    return () => { f.calls.push('dispose'); throw rejection }
  }
  f.effects.send = async () => ack
  await assert.rejects(f.transaction.run(f.request, f.effects), cause => cause === rejection)
  assert.deepEqual(f.staging.snapshot('tx').fields[0], ['written Q', 'written A'])
  assert.equal(f.ledger.isAttached('child'), true)
  assert.equal(f.ledger.completePhysical('child', physical(error('late'))), true)
  assert.equal(f.calls.includes('abort'), false)
})
