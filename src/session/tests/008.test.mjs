import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SessionFamilyTree,
  SessionTopologyStore
} from 'wanxiangli/ownership'

test('SPEC[family-tree-001] Flat affiliation ("a son's son is a son") and reparenting', () => {
  const tree = new SessionFamilyTree()

  // Register child-1 under root-1
  const rootForChild1 = tree.registerChild('root-1', 'child-1')
  assert.equal(rootForChild1, 'root-1')
  assert.equal(tree.familyRootOf('child-1'), 'root-1')
  assert.equal(tree.isManagedChild('child-1'), true)

  // Register child-2 under child-1 -> must flatten to root-1
  const rootForChild2 = tree.registerChild('child-1', 'child-2')
  assert.equal(rootForChild2, 'root-1')
  assert.equal(tree.familyRootOf('child-2'), 'root-1')
  assert.equal(tree.isManagedChild('child-2'), true)

  // Listing children of root-1 contains both child-1 and child-2
  const children = tree.listChildren('root-1')
  assert.equal(children.length, 2)
  assert.ok(children.includes('child-1'))
  assert.ok(children.includes('child-2'))

  // Reparenting child-2 to another root-2
  const newRoot = tree.registerChild('root-2', 'child-2')
  assert.equal(newRoot, 'root-2')
  assert.equal(tree.familyRootOf('child-2'), 'root-2')
  assert.ok(!tree.listChildren('root-1').includes('child-2'))
  assert.ok(tree.listChildren('root-2').includes('child-2'))
})

test('SPEC[family-tree-002] Multi-hop ancestry resolution caches proved chain and avoids redundant queries', async () => {
  const tree = new SessionFamilyTree()
  let queryCount = 0

  // Host chain: leaf-1 -> sub-1 -> root-host -> null
  const hostParents = {
    'leaf-1': 'sub-1',
    'sub-1': 'root-host',
    'root-host': null
  }

  const stepQuery = async (current) => {
    queryCount++
    if (Object.prototype.hasOwnProperty.call(hostParents, current)) {
      return { ok: true, parent: hostParents[current] }
    }
    return { ok: false, error: 'unknown node' }
  }

  // First resolution: walks leaf-1 -> sub-1 -> root-host (3 queries)
  const res1 = await tree.resolveFamilyRoot('leaf-1', stepQuery)
  assert.equal(res1.ok, true)
  assert.equal(res1.root, 'root-host')
  assert.equal(queryCount, 3)

  // Sub-session sub-1 and leaf-1 are now proved in memory
  assert.equal(tree.familyRootOf('leaf-1'), 'root-host')
  assert.equal(tree.familyRootOf('sub-1'), 'root-host')

  // Second resolution: zero additional host queries
  const res2 = await tree.resolveFamilyRoot('sub-1', stepQuery)
  assert.equal(res2.ok, true)
  assert.equal(res2.root, 'root-host')
  assert.equal(queryCount, 3, 'Proved ancestry must not query host again')
})

test('SPEC[family-tree-003] Missing edge or transport query failure fails closed and refuses to guess root', async () => {
  const tree = new SessionFamilyTree()

  // Transport failure during ancestor step query
  const res = await tree.resolveFamilyRoot('unknown-node', async () => {
    return { ok: false, error: 'Host transport timeout' }
  })

  assert.equal(res.ok, false)
  assert.equal(res.root, null)
  assert.ok(res.error.includes('Host transport timeout'))

  // Must not have registered unknown-node as a known root
  const snap = tree.snapshot()
  assert.ok(!snap.roots.includes('unknown-node'))
})

test('SPEC[family-tree-004] Cycle detection fails closed with descriptive error and creates no bindings', async () => {
  const tree = new SessionFamilyTree()

  // Circular graph: cycle-a -> cycle-b -> cycle-a
  const cycleMap = {
    'cycle-a': 'cycle-b',
    'cycle-b': 'cycle-a'
  }

  const res = await tree.resolveFamilyRoot('cycle-a', async (curr) => {
    return { ok: true, parent: cycleMap[curr] }
  })

  assert.equal(res.ok, false)
  assert.equal(res.root, null)
  assert.ok(res.error.includes('Session ancestry cycle detected at cycle-a'))

  // Snapshot has no corrupted links
  const snap = tree.snapshot()
  assert.equal(snap.roots.length, 0)
})

test('SPEC[family-tree-005] Ghost revival protection: in-flight query does not write back to cleared session or aborting root', async () => {
  const tree = new SessionFamilyTree()

  let resolveBlocked = null
  const blockPromise = new Promise(resolve => { resolveBlocked = resolve })

  const stepQuery = async (current) => {
    if (current === 'transient-child') {
      // Pause at step 1 to simulate async delay
      await blockPromise
      return { ok: true, parent: 'real-root' }
    }
    if (current === 'real-root') {
      return { ok: true, parent: null }
    }
    return { ok: false, error: 'unexpected' }
  }

  // Start resolution in background
  const resolutionPromise = tree.resolveFamilyRoot('transient-child', stepQuery)

  // Before host query completes, session is destroyed/cleared externally
  tree.clearSession('transient-child')

  // Unblock host response
  resolveBlocked()
  const res = await resolutionPromise

  // Resolution is rejected/discarded
  assert.equal(res.ok, false)
  assert.ok(res.error.includes('cleared or aborting'))

  // Ghost check: transient-child MUST NOT be resurrected in childParents or parentChildMap
  assert.equal(tree.isManagedChild('transient-child'), false)
  const snap = tree.snapshot()
  const childParentsMap = new Map(snap.childParents)
  assert.equal(childParentsMap.has('transient-child'), false, 'Cleared session must not be revived by delayed query')
})

test('SPEC[family-tree-006] Two-step abort messages: childrenToAbort reads targets, settleAbort only prunes confirmed successes', () => {
  const tree = new SessionFamilyTree()

  tree.registerChild('root-1', 'worker-1')
  tree.registerChild('root-1', 'worker-2')

  // Step 1: childrenToAbort returns snapshot without touching roster
  const targets = tree.childrenToAbort('root-1')
  assert.equal(targets.length, 2)
  assert.ok(targets.includes('worker-1'))
  assert.ok(targets.includes('worker-2'))

  // Both still managed and in roster before settlement
  assert.equal(tree.isManagedChild('worker-1'), true)
  assert.equal(tree.isManagedChild('worker-2'), true)
  assert.equal(tree.listChildren('root-1').length, 2)

  // Step 2: Settle abort results - worker-1 succeeded (true), worker-2 failed (false)
  tree.settleAbort('root-1', [
    ['worker-1', true],
    ['worker-2', false]
  ])

  // Confirmed success is cleanly removed
  assert.equal(tree.isManagedChild('worker-1'), false)

  // Failed worker-2 is strictly retained on roster for retry!
  assert.equal(tree.isManagedChild('worker-2'), true)
  assert.equal(tree.listChildren('root-1').length, 1)
  assert.ok(tree.listChildren('root-1').includes('worker-2'))

  // Subsequent abort retry succeeds
  const retryTargets = tree.childrenToAbort('root-1')
  assert.equal(retryTargets.length, 1)
  assert.equal(retryTargets[0], 'worker-2')

  tree.settleAbort('root-1', [
    ['worker-2', true]
  ])

  // Now all clean
  assert.equal(tree.isManagedChild('worker-2'), false)
  assert.equal(tree.listChildren('root-1').length, 0)
})

test('SPEC[family-tree-007] Physical topology and management tree coexist orthogonally', () => {
  const topology = new SessionTopologyStore()
  const family = new SessionFamilyTree()

  // Physical parent: worker-sub is physically created by parent-lead
  topology.putParent('worker-sub', 'parent-lead')
  topology.putParent('parent-lead', 'grand-boss')

  // Management root: both worker-sub and parent-lead belong to grand-boss
  family.registerChild('grand-boss', 'parent-lead')
  family.registerChild('parent-lead', 'worker-sub')

  // Physical parent of worker-sub is parent-lead
  assert.equal(topology.getParent('worker-sub'), 'parent-lead')
  // Management root of worker-sub is grand-boss
  assert.equal(family.familyRootOf('worker-sub'), 'grand-boss')
  assert.notEqual(topology.getParent('worker-sub'), family.familyRootOf('worker-sub'))
})
