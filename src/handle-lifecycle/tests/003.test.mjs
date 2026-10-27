import test from 'node:test'
import assert from 'node:assert/strict'

import { PendingRunStore, pendingRunStore } from 'wanxiangli/handle-lifecycle'

test('SPEC[pending-run-store-1] register and tryGetPayload roundtrip with exact token', () => {
  const store = new PendingRunStore()
  const token = { id: 'tok-1' }
  const payload = { task: 'work-1' }

  const res = store.register('agent-1', token, 'child-1', 'Engineer', payload)
  assert.equal(res.registered, true)
  assert.equal(res.agentId, 'agent-1')
  assert.equal(res.token, token)
  assert.equal(store.containsAgent('agent-1'), true)
  assert.equal(store.tryGetPayload('agent-1'), payload)
  assert.equal(store.count, 1)
})

test('SPEC[pending-run-store-2] claim marks finished and allPayloads includes claimed records while activePayloads excludes them', () => {
  const store = new PendingRunStore()
  const tok1 = { id: 'tok-1' }
  const tok2 = { id: 'tok-2' }
  const pay1 = { name: 'run-1' }
  const pay2 = { name: 'run-2' }

  store.register('agent-1', tok1, 'child-1', 'Engineer', pay1)
  store.register('agent-2', tok2, 'child-2', 'DevOps', pay2)

  assert.equal(store.count, 2)
  assert.equal(store.activePayloads().length, 2)
  assert.equal(store.allPayloads().length, 2)

  // Claim agent-1
  const claimRes = store.claim('agent-1', tok1)
  assert.equal(claimRes.claimed, true)
  assert.equal(claimRes.payload, pay1)

  // activePayloads only returns unfinished runs
  const active = store.activePayloads()
  assert.equal(active.length, 1)
  assert.equal(active[0], pay2)

  // allPayloads returns all registered unremoved runs (including claimed)
  const all = store.allPayloads()
  assert.equal(all.length, 2)
  assert.equal(store.containsAgent('agent-1'), true)
  assert.equal(store.isFinished('agent-1', tok1), true)

  // Second claim fails (AlreadyFinished)
  const duplicateClaim = store.claim('agent-1', tok1)
  assert.equal(duplicateClaim.claimed, false)
  assert.equal(duplicateClaim.reason, 'AlreadyFinished')

  // removeClaimed removes physically
  assert.equal(store.removeClaimed('agent-1', tok1), true)
  assert.equal(store.containsAgent('agent-1'), false)
  assert.equal(store.count, 1)
  assert.equal(store.allPayloads().length, 1)
})

test('SPEC[pending-run-store-3] settleParentCancelled atomically removes and settles with exact token', () => {
  const store = new PendingRunStore()
  const tok = { id: 'tok-parent' }
  const sub = { disposed: false, dispose() { this.disposed = true } }
  const pay = { item: 'parent-run' }

  store.register('agent-p', tok, 'child-p', 'Engineer', pay, sub)
  assert.equal(store.count, 1)

  // Settle parent cancelled with wrong token fails
  const badTokenRes = store.settleParentCancelled('agent-p', { wrong: true })
  assert.equal(badTokenRes.claimed, false)
  assert.equal(badTokenRes.reason, 'TokenMismatch')
  assert.equal(store.count, 1)

  // Exact token succeeds
  const okRes = store.settleParentCancelled('agent-p', tok)
  assert.equal(okRes.claimed, true)
  assert.equal(okRes.payload, pay)
  assert.equal(okRes.subscription, sub)
  assert.equal(store.count, 0)
  assert.equal(store.containsAgent('agent-p'), false)

  // Second settle fails (NotFound)
  const secondRes = store.settleParentCancelled('agent-p', tok)
  assert.equal(secondRes.claimed, false)
  assert.equal(secondRes.reason, 'NotFound')
})

test('SPEC[pending-run-store-4] drainAll clears all records and returns payloads and subscriptions', () => {
  const store = new PendingRunStore()
  const tok1 = { id: 'tok-1' }
  const sub1 = { id: 'sub-1' }
  const pay1 = { val: 1 }

  const tok2 = { id: 'tok-2' }
  const pay2 = { val: 2 }

  store.register('a1', tok1, 'c1', 'Role1', pay1, sub1)
  store.register('a2', tok2, 'c2', 'Role2', pay2)

  assert.equal(store.count, 2)
  const drained = store.drainAll()
  assert.equal(drained.length, 2)
  assert.equal(store.count, 0)
  assert.equal(store.allPayloads().length, 0)
  assert.equal(store.activePayloads().length, 0)

  const items = drained.map(d => ({ agentId: d.agentId, payload: d.payload, subscription: d.subscription }))
  assert.deepEqual(items, [
    { agentId: 'a1', payload: pay1, subscription: sub1 },
    { agentId: 'a2', payload: pay2, subscription: null }
  ])
})

test('SPEC[pending-run-store-5] singleton instance pendingRunStore is accessible and isolated', () => {
  assert.ok(pendingRunStore instanceof PendingRunStore)
  pendingRunStore.clear()
  assert.equal(pendingRunStore.count, 0)
})
