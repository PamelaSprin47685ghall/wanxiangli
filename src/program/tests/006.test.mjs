import test from 'node:test'
import assert from 'node:assert/strict'
import { ActiveTurnBridge, activeTurnBridge } from '../../../dist/program/Program.js'

test('ActiveTurnBridge acquires lease, resolves host and ask, and releases with token matching', async () => {
  const bridge = new ActiveTurnBridge()
  const host = { name: 'testHost' }
  const ask = async (q) => ({ ok: true, q })

  const token = bridge.acquire('session-1', host, ask)
  assert.equal(typeof token, 'string')
  assert.ok(token.length > 0)
  assert.equal(bridge.count, 1)

  assert.equal(bridge.resolveHost('session-1'), host)
  assert.equal(bridge.resolveAsk('session-1'), ask)

  // Mismatched token does not release
  const wrongRelease = bridge.release('session-1', 'wrong-token')
  assert.equal(wrongRelease, false)
  assert.equal(bridge.count, 1)
  assert.equal(bridge.resolveHost('session-1'), host)

  // Correct token releases
  const correctRelease = bridge.release('session-1', token)
  assert.equal(correctRelease, true)
  assert.equal(bridge.count, 0)
  assert.equal(bridge.resolveHost('session-1'), null)
  assert.equal(bridge.resolveAsk('session-1'), null)
})

test('ActiveTurnBridge clearSession and clearAll isolation', async () => {
  const bridge = new ActiveTurnBridge()
  bridge.acquire('s1', { h: 1 }, null)
  bridge.acquire('s2', { h: 2 }, null)
  assert.equal(bridge.count, 2)

  bridge.clearSession('s1')
  assert.equal(bridge.count, 1)
  assert.equal(bridge.resolveHost('s1'), null)
  assert.notEqual(bridge.resolveHost('s2'), null)

  bridge.clearAll()
  assert.equal(bridge.count, 0)
})

test('activeTurnBridge singleton is exported and operational', async () => {
  assert.ok(activeTurnBridge instanceof ActiveTurnBridge)
  activeTurnBridge.clearAll()
  const t = activeTurnBridge.acquire('global-s', { g: true }, null)
  assert.equal(activeTurnBridge.resolveHost('global-s').g, true)
  activeTurnBridge.release('global-s', t)
  assert.equal(activeTurnBridge.count, 0)
})
