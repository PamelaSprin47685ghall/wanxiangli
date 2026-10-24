import test from 'node:test'
import assert from 'node:assert/strict'
import { Wait } from '../../../../dist/program/Program.js'
import { describe, registry } from './support.mjs'

test('WHAT[CAUSAL-WAIT-008] registries are process-local and mutually invisible', () => {
  const one = registry()
  const two = registry()
  const lease = Wait.enter(one, describe())
  assert.equal(Wait.snapshot(one).active.length, 1)
  assert.equal(Wait.snapshot(two).active.length, 0)
  Wait.dispose(lease)
})

test('WHAT[CAUSAL-WAIT-008] a fresh registry starts empty: old observations do not survive', () => {
  const first = registry()
  Wait.enter(first, describe())
  // “重启”即新实例；旧观测安全消失，业务从持久化事实重新进入普通流程。
  const restarted = registry()
  assert.equal(Wait.snapshot(restarted).active.length, 0)
  assert.equal(Wait.snapshot(restarted).history.length, 0)
})

test('WHAT[CAUSAL-WAIT-008] history is bounded by the declared capacity', () => {
  const runtime = Wait.createRegistry(4)
  assert.equal(Wait.historyCapacity(runtime), 4)
  for (let i = 0; i < 10; i++) {
    const lease = Wait.enter(runtime, describe({ ownerId: 'w' + i }))
    Wait.dispose(lease)
  }
  const history = Wait.snapshot(runtime).history
  assert.equal(history.length, 4)
})
