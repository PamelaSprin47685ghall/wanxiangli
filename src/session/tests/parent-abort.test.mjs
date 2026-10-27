import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ParentAbortRegistry,
  parentAbortRegistry
} from 'wanxiangli/ownership'

test('SPEC[parent-abort-001] register returns monotonic incremental tokens per instance', () => {
  const registry = new ParentAbortRegistry()
  const t1 = registry.register('parent-1', () => {})
  const t2 = registry.register('parent-1', () => {})
  const t3 = registry.register('parent-2', () => {})
  assert.equal(t1, 1)
  assert.equal(t2, 2)
  assert.equal(t3, 3)
})

test('SPEC[parent-abort-002] unregister removes callback and deletes parent entry when empty', () => {
  const registry = new ParentAbortRegistry()
  let called = false
  const token = registry.register('parent-a', () => { called = true })
  assert.equal(registry.hasParent('parent-a'), true)

  registry.unregister('parent-a', token)
  assert.equal(registry.hasParent('parent-a'), false)

  // Unregister non-existent token is idempotent
  registry.unregister('parent-a', 999)
  registry.unregister('unknown-parent', 1)

  // Aborting should not invoke unregistered callback
  registry.abortParent('parent-a')
  assert.equal(called, false)
})

test('SPEC[parent-abort-003] unregister only removes specified callback among multiple callbacks', () => {
  const registry = new ParentAbortRegistry()
  let c1 = false
  let c2 = false
  const t1 = registry.register('parent-x', () => { c1 = true })
  const t2 = registry.register('parent-x', () => { c2 = true })

  registry.unregister('parent-x', t1)
  assert.equal(registry.hasParent('parent-x'), true)

  registry.abortParent('parent-x')
  assert.equal(c1, false)
  assert.equal(c2, true)
  assert.equal(registry.hasParent('parent-x'), true)
})

test('SPEC[parent-abort-004] abortParent invokes all callbacks for target parent and isolates other parents', () => {
  const registry = new ParentAbortRegistry()
  const invoked = []
  registry.register('p1', () => invoked.push('p1-a'))
  registry.register('p1', () => invoked.push('p1-b'))
  registry.register('p2', () => invoked.push('p2-a'))

  registry.abortParent('p1')
  assert.deepEqual(invoked, ['p1-a', 'p1-b'])

  registry.abortParent('p2')
  assert.deepEqual(invoked, ['p1-a', 'p1-b', 'p2-a'])

  // Aborting unknown parent is safe no-op
  registry.abortParent('p-unknown')
  assert.deepEqual(invoked, ['p1-a', 'p1-b', 'p2-a'])
})

test('SPEC[parent-abort-005] abortParent tolerates throwing callbacks and continues executing others', () => {
  const registry = new ParentAbortRegistry()
  const order = []
  registry.register('p-err', () => { order.push(1) })
  registry.register('p-err', () => {
    order.push(2)
    throw new Error('Callback boom!')
  })
  registry.register('p-err', () => { order.push(3) })

  // Calling abortParent must not throw
  assert.doesNotThrow(() => {
    registry.abortParent('p-err')
  })
  assert.deepEqual(order, [1, 2, 3])
})

test('SPEC[parent-abort-006] abortParent allows re-entrant unregister and register without deadlock', () => {
  const registry = new ParentAbortRegistry()
  let token2 = 0
  let token3 = 0
  let c1Ran = false
  let c2Ran = false
  let c3Ran = false

  const token1 = registry.register('p-reentrant', () => {
    c1Ran = true
    // Re-entrant unregister of another token
    registry.unregister('p-reentrant', token2)
    // Re-entrant register
    token3 = registry.register('p-reentrant', () => { c3Ran = true })
  })

  token2 = registry.register('p-reentrant', () => {
    c2Ran = true
  })

  assert.doesNotThrow(() => {
    registry.abortParent('p-reentrant')
  })

  assert.equal(c1Ran, true)
  // Because callbacks were snapshotted before invocation, token2 was already in the snapshot list
  // so it runs, but future aborts will not see it.
  assert.equal(c2Ran, true)
  // token3 was registered during abortParent, so it wasn't in the snapshot, but is now in the registry
  assert.equal(c3Ran, false)
  assert.ok(token3 > 0)

  // Second abortParent will invoke token3 and will NOT invoke token2 (since it was unregistered)
  c1Ran = false
  c2Ran = false
  registry.abortParent('p-reentrant')
  assert.equal(c1Ran, true)
  assert.equal(c2Ran, false)
  assert.equal(c3Ran, true)
})

test('SPEC[parent-abort-007] clear removes all registered parents and resets token', () => {
  const registry = new ParentAbortRegistry()
  registry.register('p1', () => {})
  registry.register('p2', () => {})
  assert.equal(registry.hasParent('p1'), true)
  assert.equal(registry.hasParent('p2'), true)

  registry.clear()
  assert.equal(registry.hasParent('p1'), false)
  assert.equal(registry.hasParent('p2'), false)

  const newToken = registry.register('p1', () => {})
  assert.equal(newToken, 1)
})

test('SPEC[parent-abort-008] multiple instances and default singleton are completely isolated', () => {
  const regA = new ParentAbortRegistry()
  const regB = new ParentAbortRegistry()

  regA.register('common-parent', () => {})
  assert.equal(regA.hasParent('common-parent'), true)
  assert.equal(regB.hasParent('common-parent'), false)
  assert.equal(parentAbortRegistry.hasParent('common-parent'), false)

  parentAbortRegistry.clear()
  const token = parentAbortRegistry.register('singleton-parent', () => {})
  assert.equal(parentAbortRegistry.hasParent('singleton-parent'), true)
  assert.equal(regA.hasParent('singleton-parent'), false)
  assert.equal(regB.hasParent('singleton-parent'), false)

  parentAbortRegistry.unregister('singleton-parent', token)
  assert.equal(parentAbortRegistry.hasParent('singleton-parent'), false)
})
