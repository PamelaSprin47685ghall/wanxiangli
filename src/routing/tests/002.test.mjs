import test from 'node:test'
import assert from 'node:assert/strict'

import { RoutingProtocol } from 'wanxiangli/routing'

const protocol = new RoutingProtocol()
const ROUTING = /^execution-model-routing: /
const route = () => null
const capacity = () => true
const ns = (fields) => ({ routingProtocol: 2, default: route, hasTheoreticalCapacity: capacity, ...fields })

test('SPEC[routing-1] admit accepts the protocol-2 shape and returns a frozen policy', () => {
  const markProviderFailed = () => {}
  const policy = protocol.admit(ns({ markProviderFailed }))
  assert.equal(protocol.version, 2)
  assert.equal(policy.route, route)
  assert.equal(policy.hasTheoreticalCapacity, capacity)
  assert.equal(policy.markProviderFailed, markProviderFailed)
  assert.ok(Object.isFrozen(policy))
  assert.equal(protocol.admit(ns({})).markProviderFailed, null)
})

test('SPEC[routing-1] admit fails closed on a missing or non-function default export', () => {
  assert.throws(() => protocol.admit(null), /default export.*function/)
  assert.throws(() => protocol.admit(ns({ default: 42 })), /default export.*function/)
})

test('SPEC[routing-1] the protocol version is an exact number, not an enable switch', () => {
  assert.throws(() => protocol.admit(ns({ routingProtocol: undefined })), /must export `routingProtocol = 2`/)
  assert.throws(() => protocol.admit(ns({ routingProtocol: '2' })), /must be the number 2/)
  assert.throws(() => protocol.admit(ns({ routingProtocol: 1 })), /declares routingProtocol = 1/)
  assert.throws(() => protocol.admit(ns({ routingProtocol: 3 })), /declares routingProtocol = 3/)
  assert.throws(() => protocol.admit(ns({ routingProtocol: 3 })), /never overwritten/)
})

test('SPEC[routing-1] counterexample: a module without hasTheoreticalCapacity is refused, not given infinite capacity', () => {
  assert.throws(() => protocol.admit(ns({ hasTheoreticalCapacity: undefined })), /hasTheoreticalCapacity/)
  assert.throws(() => protocol.admit(ns({ hasTheoreticalCapacity: true })), /hasTheoreticalCapacity/)
})

test('SPEC[routing-1] an exported markProviderFailed must be a function', () => {
  assert.throws(() => protocol.admit(ns({ markProviderFailed: 'yes' })), /markProviderFailed/)
})

test('SPEC[routing-2] route is called with exactly role, running, previous and returns a decoded target', () => {
  let seen
  const scheduler = function (...args) {
    seen = args
    return { model: ' provider/model ', reasoning: ' high ', extra: 1 }
  }
  const running = [{ model: 'a/x', reasoning: 'none' }, { model: 'a/x', reasoning: 'none' }]
  const target = protocol.route(scheduler, ' engineer ', running, { model: 'p/q', reasoning: 'low' })
  assert.deepEqual(target, { model: 'provider/model', reasoning: 'high' })
  assert.ok(Object.isFrozen(target))
  assert.equal(seen.length, 3)
  assert.equal(seen[0], 'engineer')
  assert.deepEqual(seen[1], running, 'duplicates are kept')
  assert.deepEqual(seen[2], { model: 'p/q', reasoning: 'low' })
  assert.equal(protocol.route(() => null, 'engineer', [], null), null)
  let previous = 'unset'
  protocol.route((_r, _run, p) => { previous = p; return null }, 'engineer', [], null)
  assert.equal(previous, null)
})

test('SPEC[routing-2] the scheduler receives copies and cannot rewrite the caller ledger', () => {
  const running = [{ model: 'a/x', reasoning: 'none' }]
  const previous = { model: 'a/x', reasoning: 'none' }
  protocol.route((_role, run, prev) => {
    assert.throws(() => { run.push({ model: 'b/y', reasoning: 'none' }) }, TypeError)
    assert.throws(() => { run[0].model = 'evil/z' }, TypeError)
    assert.throws(() => { prev.reasoning = 'max' }, TypeError)
    return null
  }, 'engineer', running, previous)
  assert.deepEqual(running, [{ model: 'a/x', reasoning: 'none' }])
  assert.deepEqual(previous, { model: 'a/x', reasoning: 'none' })
})

test('SPEC[routing-2] undefined from the scheduler is waiting, like null', () => {
  assert.equal(protocol.route(() => undefined, 'engineer', [], null), null)
})

test('SPEC[routing-2] Promise, throw and illegal targets fail closed', () => {
  assert.throws(() => protocol.route(async () => ({ model: 'p/m', reasoning: 'none' }), 'engineer', [], null), /synchronous.*Promise/)
  assert.throws(() => protocol.route(() => ({ then() {} }), 'engineer', [], null), /Promise/)
  assert.throws(() => protocol.route(() => { throw new Error('bad scheduler program') }, 'engineer', [], null), /bad scheduler program/)
  for (const bad of [
    { model: 'bare-model', reasoning: 'none' },
    { model: '/model', reasoning: 'none' },
    { model: 'provider/', reasoning: 'none' },
    { model: 'p/m', reasoning: '  ' },
    { model: 'p/m' },
    { model: 7, reasoning: 'none' },
    { model: 'p/m', reasoning: 0 },
    'p/m',
  ]) {
    assert.throws(() => protocol.route(() => bad, 'engineer', [], null), ROUTING, JSON.stringify(bad))
  }
  assert.throws(() => protocol.route(42, 'engineer', [], null), /default export.*function/)
  assert.throws(() => protocol.route(route, ' ', [], null), /role must be non-empty/)
  assert.throws(() => protocol.route(route, 'engineer', null, null), /running/)
  assert.throws(() => protocol.route(route, 'engineer', [{ model: 'x', reasoning: 'n' }], null), /provider\/model/)
})

test('SPEC[routing-3] counterexample: an async capacity query is not theoretical capacity', () => {
  assert.throws(() => protocol.hasTheoreticalCapacity(async () => false, 'engineer'), /synchronous.*Promise/)
  assert.throws(() => protocol.hasTheoreticalCapacity(() => 'false', 'engineer'), /must return a boolean/)
  assert.throws(() => protocol.hasTheoreticalCapacity(() => 1, 'engineer'), /must return a boolean/)
  assert.throws(() => protocol.hasTheoreticalCapacity(() => undefined, 'engineer'), /must return a boolean/)
  assert.throws(() => protocol.hasTheoreticalCapacity(undefined, 'engineer'), /must be a function/)
})

test('SPEC[routing-3] the capacity query answers per role with one argument', () => {
  let args
  const query = (...seen) => { args = seen; return seen[0] === 'engineer' }
  assert.equal(protocol.hasTheoreticalCapacity(query, ' engineer '), true)
  assert.deepEqual(args, ['engineer'])
  assert.equal(protocol.hasTheoreticalCapacity(query, 'plan'), false)
})

test('SPEC[routing-4] durable road targets decode with the same field rules', () => {
  assert.deepEqual(protocol.decodeDurableTarget(' cursor/grok:xhigh '), { model: 'cursor/grok', reasoning: 'xhigh' })
  // counterexample: the first ':' would read 'ollama-cloud/gemma4' with reasoning '31b:none'.
  assert.deepEqual(protocol.decodeDurableTarget('ollama-cloud/gemma4:31b:none'), { model: 'ollama-cloud/gemma4:31b', reasoning: 'none' })
  for (const bad of ['', '  ', 'cursor/grok', ':xhigh', 'cursor/grok:', 'grok:xhigh', 'cursor/grok: ']) {
    assert.throws(() => protocol.decodeDurableTarget(bad), ROUTING, bad)
  }
  assert.throws(() => protocol.decodeDurableTarget(null), /empty/)
})

test('SPEC[routing-4] decodeTarget and providerOf', () => {
  assert.deepEqual(protocol.decodeTarget({ model: ' a/b/c ', reasoning: 'x' }), { model: 'a/b/c', reasoning: 'x' })
  assert.equal(protocol.providerOf({ model: 'a/b/c', reasoning: 'x' }), 'a')
  assert.throws(() => protocol.decodeTarget(null), /null is not a target/)
  assert.throws(() => protocol.providerOf({ model: 'ab', reasoning: 'x' }), /provider\/model/)
})
