import test from 'node:test'
import assert from 'node:assert/strict'
import { Wait } from '../../../dist/wait/Wait.js'
import { describe, owner, externalProducer, workflowProducer } from './support.mjs'

// 卡内红反例 4：因果前沿的环检测与断边识别。

const kinds = frontiers => frontiers.map(frontier => frontier.kind)

test('WHAT[CAUSAL-WAIT-007] a two-owner cycle is diagnosed as CausalWaitCycle', () => {
  const a = describe({ ownerId: 'a', producer: workflowProducer(owner('engineer', { id: 'b' })) })
  const b = describe({ ownerId: 'b', producer: workflowProducer(owner('engineer', { id: 'a' })) })
  const frontiers = Wait.frontiers([a, b])
  assert.ok(frontiers.some(frontier => frontier.kind === 'CausalWaitCycle'))
  const cycle = frontiers.find(frontier => frontier.kind === 'CausalWaitCycle')
  assert.ok(cycle.cycle.length >= 2)
})

test('WHAT[CAUSAL-WAIT-007] waiting for an inactive owner is a BrokenCausalEdge', () => {
  const a = describe({ ownerId: 'a', producer: workflowProducer(owner('engineer', { id: 'ghost' })) })
  const frontiers = Wait.frontiers([a])
  assert.deepEqual(kinds(frontiers), ['BrokenCausalEdge'])
  assert.match(frontiers[0].detail, /ghost/)
})

test('WHAT[CAUSAL-WAIT-007] an external producer surfaces as ExternalProducerFrontier', () => {
  const a = describe({ ownerId: 'a', producer: externalProducer('provider', { family: 'glm' }) })
  const frontiers = Wait.frontiers([a])
  assert.deepEqual(kinds(frontiers), ['ExternalProducerFrontier'])
  assert.equal(frontiers[0].producer.kind, 'external')
  assert.equal(frontiers[0].producer.producerKind, 'provider')
})

test('WHAT[CAUSAL-WAIT-007] a chained wait walks to the deepest unsatisfied frontier', () => {
  // a → b → external provider：前沿应落在链尾的外部生产者上。
  const a = describe({ ownerId: 'a', producer: workflowProducer(owner('engineer', { id: 'b' })) })
  const b = describe({ ownerId: 'b', producer: externalProducer('provider', { family: 'glm' }) })
  const frontiers = Wait.frontiers([a, b])
  const external = frontiers.filter(frontier => frontier.kind === 'ExternalProducerFrontier')
  assert.equal(external.length, 1)
  assert.equal(external[0].chain.length, 2)
  assert.equal(external[0].chain[0].owner.identity.id, 'a')
  assert.equal(external[0].chain[1].owner.identity.id, 'b')
})

test('WHAT[CAUSAL-WAIT-007] no active waits yields the Empty frontier', () => {
  const frontiers = Wait.frontiers([])
  assert.deepEqual(kinds(frontiers), ['Empty'])
})

test('WHAT[CAUSAL-WAIT-007] the same algorithm runs on a snapshot object', () => {
  const a = describe({ ownerId: 'a', producer: externalProducer('provider', { family: 'glm' }) })
  const fromArray = Wait.frontiers([a])
  const fromSnapshot = Wait.frontiersOfSnapshot({ active: [a] })
  assert.deepEqual(kinds(fromSnapshot), kinds(fromArray))
})
