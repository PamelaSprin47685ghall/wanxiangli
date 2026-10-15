import test from 'node:test'
import assert from 'node:assert/strict'
import { Wait } from '../../../dist/wait/Wait.js'
import { describe, registry } from './support.mjs'

test('WHAT[CAUSAL-WAIT-001] entering a wait makes it observable, disposing clears it', () => {
  const runtime = registry()
  const lease = Wait.enter(runtime, describe())
  const active = Wait.snapshot(runtime).active
  assert.equal(active.length, 1)
  assert.equal(active[0].waitKind, 'join')

  Wait.dispose(lease)
  assert.equal(Wait.snapshot(runtime).active.length, 0)
})

test('WHAT[CAUSAL-WAIT-001] observation never decides anything: snapshots are pure reads', () => {
  const runtime = registry()
  const lease = Wait.enter(runtime, describe())
  const first = Wait.snapshot(runtime)
  const second = Wait.snapshot(runtime)
  // 读快照不改变活跃集，也不产生新的等待转移。
  assert.equal(first.active.length, second.active.length)
  assert.equal(second.history.length, first.history.length)
  Wait.dispose(lease)
})

test('WHAT[CAUSAL-WAIT-001] the registry holds no business authority: it is plain data in memory', () => {
  const runtime = registry()
  const lease = Wait.enter(runtime, describe({ ownerId: 'x' }))
  // 观测只是登记；没有许可、没有终态、没有对外效果。
  assert.equal(typeof Wait.markExit, 'function')
  Wait.markExit(lease, 'WaitResolved')
  Wait.dispose(lease)
  const history = Wait.snapshot(runtime).history
  assert.equal(history[history.length - 1].exit, 'WaitResolved')
})
