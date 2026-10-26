import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SessionTopologyStore,
  sessionTopologyStore,
  SignalBroadcaster
} from 'wanxiangli/ownership'

test('SPEC[session-topology-001] SessionTopologyStore manages parents and directories with clean mutation and clearing', () => {
  const store = new SessionTopologyStore()

  // Initial state
  assert.equal(store.getParent('child-1'), null)
  assert.equal(store.tryGetParent('child-1'), undefined)
  assert.equal(store.getDirectory('ses-1'), null)
  assert.equal(store.tryGetDirectory('ses-1'), undefined)

  // Put and get parents
  store.putParent('child-1', 'parent-1')
  store.putParent('child-2', 'parent-1')
  assert.equal(store.getParent('child-1'), 'parent-1')
  assert.equal(store.tryGetParent('child-1'), 'parent-1')
  assert.equal(store.getParent('child-2'), 'parent-1')

  // Put and get directories
  store.putDirectory('ses-1', '/workspace/ses-1')
  store.putDirectory('child-1', '/workspace/worktree-1')
  assert.equal(store.getDirectory('ses-1'), '/workspace/ses-1')
  assert.equal(store.tryGetDirectory('child-1'), '/workspace/worktree-1')

  // Remove parent and directory individually
  assert.equal(store.removeParent('child-2'), true)
  assert.equal(store.getParent('child-2'), null)
  assert.equal(store.removeParent('nonexistent'), false)

  assert.equal(store.removeDirectory('ses-1'), true)
  assert.equal(store.getDirectory('ses-1'), null)
  assert.equal(store.removeDirectory('nonexistent'), false)

  // clearSession removes both parent and directory for that session
  store.clearSession('child-1')
  assert.equal(store.getParent('child-1'), null)
  assert.equal(store.getDirectory('child-1'), null)

  // clearAll
  store.putParent('a', 'b')
  store.putDirectory('a', '/dir')
  store.clearAll()
  assert.equal(store.getParent('a'), null)
  assert.equal(store.getDirectory('a'), null)
})

test('SPEC[session-topology-002] parentsMap and directoriesMap mirror mutations directly', () => {
  const store = new SessionTopologyStore()
  const parents = store.parentsMap
  const dirs = store.directoriesMap

  store.putParent('c1', 'p1')
  assert.equal(parents.get('c1'), 'p1')

  store.putDirectory('s1', '/path/s1')
  assert.equal(dirs.get('s1'), '/path/s1')

  store.clearParents()
  assert.equal(parents.size, 0)

  store.clearDirectories()
  assert.equal(dirs.size, 0)
})

test('SPEC[session-topology-003] sessionTopologyStore singleton provides cross-import live singleton truth', () => {
  sessionTopologyStore.clearAll()

  sessionTopologyStore.putParent('live-child', 'live-parent')
  sessionTopologyStore.putDirectory('live-child', '/live/dir')

  assert.equal(sessionTopologyStore.getParent('live-child'), 'live-parent')
  assert.equal(sessionTopologyStore.getDirectory('live-child'), '/live/dir')

  // Isolation cleanup
  sessionTopologyStore.clearAll()
  assert.equal(sessionTopologyStore.getParent('live-child'), null)
  assert.equal(sessionTopologyStore.getDirectory('live-child'), null)
})

test('SPEC[signal-broadcaster-001] SignalBroadcaster manages subscriber lifecycle and snapshot ordering', () => {
  const broadcaster = new SignalBroadcaster()
  assert.deepEqual(broadcaster.snapshot(), [])

  const events = []
  const sub1 = broadcaster.subscribe((s) => events.push(['sub1', s]))
  const sub2 = broadcaster.subscribe((s) => events.push(['sub2', s]))

  const listeners = broadcaster.snapshot()
  assert.equal(listeners.length, 2)

  for (const fn of listeners) {
    fn('sig-A')
  }
  assert.deepEqual(events, [
    ['sub1', 'sig-A'],
    ['sub2', 'sig-A']
  ])

  // Dispose sub1 idempotently
  sub1.dispose()
  sub1.dispose()

  const remaining = broadcaster.snapshot()
  assert.equal(remaining.length, 1)

  for (const fn of remaining) {
    fn('sig-B')
  }
  assert.deepEqual(events, [
    ['sub1', 'sig-A'],
    ['sub2', 'sig-A'],
    ['sub2', 'sig-B']
  ])

  sub2.dispose()
  assert.deepEqual(broadcaster.snapshot(), [])
})
