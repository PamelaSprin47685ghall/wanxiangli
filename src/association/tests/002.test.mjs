import test from 'node:test'
import assert from 'node:assert/strict'

import { TurnBindingStore, turnBindingStore } from 'wanxiangli/association'

test('SPEC[turn-binding-1] BindUserMessage derives authority root and preserves existing role', () => {
  const store = new TurnBindingStore()

  // First bind: with role
  const ok1 = store.bindUserMessage('session-1', 'phys-msg-001', 'Operator')
  assert.equal(ok1, true)

  const active1 = store.activeRunBinding('session-1')
  assert.notEqual(active1, null)
  assert.equal(active1.sessionId, 'session-1')
  assert.equal(active1.authorityRootUserMessageId, 'phys-msg-001')
  assert.equal(active1.physicalUserMessageId, 'phys-msg-001')
  assert.equal(active1.role, 'Operator')

  // Second bind: without role, preserves existing 'Operator' role
  const ok2 = store.bindUserMessage('session-1', 'phys-msg-002')
  assert.equal(ok2, true)

  const active2 = store.activeRunBinding('session-1')
  assert.equal(active2.authorityRootUserMessageId, 'phys-msg-002')
  assert.equal(active2.physicalUserMessageId, 'phys-msg-002')
  assert.equal(active2.role, 'Operator')

  // Third bind: with new role, updates role
  store.bindUserMessage('session-1', 'phys-msg-003', 'User')
  const active3 = store.activeRunBinding('session-1')
  assert.equal(active3.authorityRootUserMessageId, 'phys-msg-003')
  assert.equal(active3.role, 'User')
})

test('SPEC[turn-binding-2] BindContinuationUserMessage accumulates continuation ids and updates physical cursor', () => {
  const store = new TurnBindingStore()

  // Initial user prompt
  store.bindUserMessage('session-cont', 'phys-initial', 'User')

  // First continuation
  const ok1 = store.bindContinuationUserMessage('session-cont', 'cont-phys-1')
  assert.equal(ok1, true)

  let active = store.activeRunBinding('session-cont')
  assert.equal(active.physicalUserMessageId, 'cont-phys-1')
  assert.deepEqual([...active.continuationMessageIds].sort(), ['cont-phys-1'])
  assert.equal(store.tryPhysicalUserMessage('session-cont'), 'cont-phys-1')

  // Second continuation
  const ok2 = store.bindContinuationUserMessage('session-cont', 'cont-phys-2')
  assert.equal(ok2, true)

  active = store.activeRunBinding('session-cont')
  assert.equal(active.physicalUserMessageId, 'cont-phys-2')
  assert.deepEqual([...active.continuationMessageIds].sort(), ['cont-phys-1', 'cont-phys-2'])
  assert.equal(store.tryPhysicalUserMessage('session-cont'), 'cont-phys-2')

  // Verify continuationMessageIds accessor
  assert.deepEqual([...store.getContinuationMessageIds('session-cont')].sort(), ['cont-phys-1', 'cont-phys-2'])
})

test('SPEC[turn-binding-3] BindPhysicalUserMaterial moves cursor without minting authority or continuation', () => {
  const store = new TurnBindingStore()

  // Fresh session: material replaces explicit-resume without prior user message
  const ok = store.bindPhysicalUserMaterial('session-mat', 'mat-phys-001')
  assert.equal(ok, true)

  // Cursor is updated in physicalUserMessage
  assert.equal(store.tryPhysicalUserMessage('session-mat'), 'mat-phys-001')
  assert.equal(store.getUserMessageBinding('session-mat'), 'mat-phys-001')

  const active = store.activeRunBinding('session-mat')
  assert.notEqual(active, null)
  assert.equal(active.physicalUserMessageId, 'mat-phys-001')
  // Authority root is NOT minted
  assert.equal(active.authorityRootUserMessageId, null)
  // Continuation ids are NOT minted
  assert.deepEqual(active.continuationMessageIds, [])
  assert.deepEqual(store.getContinuationMessageIds('session-mat'), [])
})

test('SPEC[turn-binding-4] BindActiveRun merges continuation message ids set', () => {
  const store = new TurnBindingStore()

  // Session has accumulated some continuation ids
  store.bindContinuationUserMessage('session-run', 'cont-early-1')
  store.bindContinuationUserMessage('session-run', 'cont-early-2')

  // Register host-provided active run with its own continuation ids
  store.bindActiveRun({
    sessionId: 'session-run',
    runId: 'run-100',
    authorityRootUserMessageId: 'root-100',
    physicalUserMessageId: 'phys-100',
    continuationMessageIds: ['cont-from-binding-3'],
    role: 'Operator',
    directory: '/workspace/test',
    inheritedAuthorityOwner: null,
  })

  const active = store.activeRunBinding('session-run')
  assert.equal(active.runId, 'run-100')
  assert.equal(active.authorityRootUserMessageId, 'root-100')
  assert.equal(active.directory, '/workspace/test')
  // The union of cont-early-1, cont-early-2, and cont-from-binding-3
  assert.deepEqual([...active.continuationMessageIds].sort(), [
    'cont-early-1',
    'cont-early-2',
    'cont-from-binding-3',
  ])
})

test('SPEC[turn-binding-5] explicit and projected merge rules', () => {
  const store = new TurnBindingStore()

  // 1. Durable authority owns the root: projected root overwrites explicit root (anti-race)
  // Host registration may have raced a continuation and promoted physical cursor by mistake
  store.bindActiveRun({
    sessionId: 'session-merge',
    runId: 'run-race',
    authorityRootUserMessageId: 'explicit-mistaken-root',
    physicalUserMessageId: 'explicit-phys',
    continuationMessageIds: ['cont-explicit'],
    role: 'Operator',
    directory: '/workspace/explicit',
    inheritedAuthorityOwner: null,
  })

  const projectedSummary = {
    activeRootId: 'durable-canonical-root',
    canonicalRole: 'User',
    inheritedOwnerSessionId: null,
    inheritedOwnerRootId: null,
    inheritedOwnerRole: null,
    lanePhysicalId: null,
  }

  const merged = store.activeRunBinding('session-merge', projectedSummary)
  assert.notEqual(merged, null)
  // Projected authority root OVERWRITES explicit root!
  assert.equal(merged.authorityRootUserMessageId, 'durable-canonical-root')
  // Explicit physical cursor is preserved!
  assert.equal(merged.physicalUserMessageId, 'explicit-phys')
  // Explicit role is preserved (Operator beats User)!
  assert.equal(merged.role, 'Operator')
  // Explicit directory is preserved!
  assert.equal(merged.directory, '/workspace/explicit')
  // Continuation ids are preserved!
  assert.deepEqual(merged.continuationMessageIds, ['cont-explicit'])

  // 2. Fission lane inherits owner root and lane physical cursor
  const laneStore = new TurnBindingStore()
  laneStore.bindContinuationUserMessage('lane-session-1', 'lane-phys-cursor')

  const laneProjectedSummary = {
    activeRootId: null,
    canonicalRole: null,
    inheritedOwnerSessionId: 'parent-owner-session',
    inheritedOwnerRootId: 'owner-authority-root',
    inheritedOwnerRole: 'Operator',
    lanePhysicalId: 'lane-phys-cursor',
  }

  const laneBinding = laneStore.activeRunBinding('lane-session-1', laneProjectedSummary)
  assert.notEqual(laneBinding, null)
  assert.equal(laneBinding.authorityRootUserMessageId, 'owner-authority-root')
  assert.equal(laneBinding.inheritedAuthorityOwner, 'parent-owner-session')
  assert.equal(laneBinding.role, 'Operator')
  assert.equal(laneBinding.physicalUserMessageId, 'lane-phys-cursor')
})

test('SPEC[turn-binding-6] TryPhysicalUserMessage fallback resolution', () => {
  const store = new TurnBindingStore()

  // Case 1: activeBinding has physicalUserMessageId -> returns activeBinding.physical
  store.bindActiveRun({
    sessionId: 'sess-fallback',
    runId: null,
    authorityRootUserMessageId: 'root-1',
    physicalUserMessageId: 'phys-from-active',
    continuationMessageIds: [],
    role: null,
    directory: null,
    inheritedAuthorityOwner: null,
  })
  assert.equal(store.tryPhysicalUserMessage('sess-fallback'), 'phys-from-active')

  // Case 2: activeBinding exists but physicalUserMessageId is null -> falls back to userMessageBindings
  store.bindPhysicalUserMaterial('sess-fallback-2', 'phys-from-user-map')
  store.bindActiveRun({
    sessionId: 'sess-fallback-2',
    runId: null,
    authorityRootUserMessageId: 'root-2',
    physicalUserMessageId: null,
    continuationMessageIds: [],
    role: null,
    directory: null,
    inheritedAuthorityOwner: null,
  })
  assert.equal(store.tryPhysicalUserMessage('sess-fallback-2'), 'phys-from-user-map')

  // Case 3: activeBinding does not exist -> falls back to userMessageBindings
  store.bindPhysicalUserMaterial('sess-fallback-3', 'phys-only-user')
  assert.equal(store.tryPhysicalUserMessage('sess-fallback-3'), 'phys-only-user')

  // Case 4: neither exists -> returns null
  assert.equal(store.tryPhysicalUserMessage('non-existent-session'), null)
})

test('SPEC[turn-binding-7] ClearSession removes all state for the session and keeps isolation', () => {
  const store = new TurnBindingStore()

  store.bindUserMessage('session-a', 'phys-a', 'User')
  store.bindContinuationUserMessage('session-a', 'cont-a')

  store.bindUserMessage('session-b', 'phys-b', 'Operator')
  store.bindContinuationUserMessage('session-b', 'cont-b')

  // Clear session-a
  const cleared = store.clearSession('session-a')
  assert.equal(cleared, true)

  // session-a is completely wiped
  assert.equal(store.activeRunBinding('session-a'), null)
  assert.equal(store.tryPhysicalUserMessage('session-a'), null)
  assert.equal(store.getUserMessageBinding('session-a'), null)
  assert.deepEqual(store.getContinuationMessageIds('session-a'), [])

  const snapA = store.snapshot('session-a')
  assert.equal(snapA.userMessageBinding, null)
  assert.equal(snapA.activeBinding, null)
  assert.deepEqual(snapA.continuationMessageIds, [])

  // session-b is completely intact (isolation)
  assert.notEqual(store.activeRunBinding('session-b'), null)
  assert.equal(store.tryPhysicalUserMessage('session-b'), 'cont-b')
  assert.equal(store.getUserMessageBinding('session-b'), 'cont-b')
  assert.deepEqual(store.getContinuationMessageIds('session-b'), ['cont-b'])

  // Multi-instance isolation
  const store2 = new TurnBindingStore()
  store2.bindUserMessage('session-b', 'phys-other-instance', 'Other')
  assert.equal(store2.tryPhysicalUserMessage('session-b'), 'phys-other-instance')
  // store1 still has cont-b
  assert.equal(store.tryPhysicalUserMessage('session-b'), 'cont-b')

  // Singleton isolation
  turnBindingStore.clearAll()
  turnBindingStore.bindUserMessage('session-single', 'phys-single')
  assert.equal(turnBindingStore.tryPhysicalUserMessage('session-single'), 'phys-single')
  assert.equal(store.tryPhysicalUserMessage('session-single'), null)
})
