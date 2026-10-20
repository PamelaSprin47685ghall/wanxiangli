import test from 'node:test'
import assert from 'node:assert/strict'
import { Ablation, node } from './support.mjs'

const law = Ablation()

test('SPEC[ablation-003] malformed input is rejected before any judgement', () => {
  assert.throws(() => law.validateNodes(null), /nodes must be an array/)
  assert.throws(() => law.validateNodes([{ id: 1, package: 'a' }]), /node.id must be a string/)
  assert.throws(() => law.validateNodes([{ id: 'a', package: 'a', parent: 3 }]), /node.parent must be a string/)
  assert.throws(() => law.findCycle([node('a')], [{ from: 'a' }]), /edge.to must be a string/)
  assert.throws(() => law.validateModes([], { a: 'on' }), /mode must be/)
  assert.throws(() => law.validateModes([], ['active']), /modes must be an object/)
  // eslint-disable-next-line no-sparse-arrays
  assert.throws(() => law.validateNodes([node('a'), , node('b')]), /must not be sparse/)
})

test('SPEC[ablation-003] accessor fields are refused without being read', () => {
  let reads = 0
  const sneaky = { package: 'a' }
  Object.defineProperty(sneaky, 'id', { enumerable: true, get: () => { reads++; return 'a' } })
  assert.throws(() => law.validateNodes([sneaky]), /Accessor field is not accepted: id/)
  const modes = {}
  Object.defineProperty(modes, 'a', { enumerable: true, get: () => { reads++; return 'active' } })
  assert.throws(() => law.validateModes([], modes), /Accessor field is not accepted: a/)
  assert.equal(reads, 0)
})

test('SPEC[ablation-003] answers are frozen and independent of later caller mutation', () => {
  const edges = [{ from: 'p', to: 't' }]
  const modes = { p: 'ablated', t: 'active' }
  const found = law.validateModes(edges, modes)
  assert.ok(Object.isFrozen(found))
  edges[0].to = 'x'
  modes.p = 'active'
  assert.equal(found.reason, 'station-order: t requires p at least borrowed before active downstream')
  assert.equal(law.validateModes(edges, modes), null)
})
