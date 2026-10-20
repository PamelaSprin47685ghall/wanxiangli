import test from 'node:test'
import assert from 'node:assert/strict'
import { Degeneration, envelope } from './support.mjs'

test('SPEC[degeneration-001] the weighted distinct count follows the decay recurrence step by step', () => {
  const detector = Degeneration(envelope()).detector()
  assert.deepEqual(detector.evaluate(), { state: 'Normal', isAnomalous: false, weightedDistinctTokens: 1.5, step: 0 })
  // D1 = 0.5*1.5 + 1 = 1.75 (new token)
  assert.equal(detector.push([7]).weightedDistinctTokens, 1.75)
  // D2 = 0.5*1.75 + (1 - 0.5^1) = 1.375 (token 7 seen one step ago)
  assert.equal(detector.push([7]).weightedDistinctTokens, 1.375)
  // D3 = 0.5*1.375 + 1 = 1.6875; D4 = 0.5*1.6875 + (1 - 0.5^2) = 1.59375
  const last = detector.push([8, 7])
  assert.equal(last.weightedDistinctTokens, 1.59375)
  assert.equal(last.step, 4)
})

test('SPEC[degeneration-001] repetition drives the count below the floor, novelty above the ceiling', () => {
  const family = Degeneration(envelope())
  const repetitive = family.detector()
  const stuck = repetitive.push(Array(20).fill(3))
  assert.equal(stuck.state, 'TooRepetitive')
  assert.equal(stuck.isAnomalous, true)
  const random = family.detector()
  const noisy = random.push(Array.from({ length: 20 }, (_, index) => index))
  assert.equal(noisy.state, 'TooRandom')
  assert.ok(noisy.weightedDistinctTokens > 1.9)
})

test('SPEC[degeneration-001] the envelope bounds themselves are Normal', () => {
  const family = Degeneration(envelope())
  assert.equal(family.classify(1.2), 'Normal')
  assert.equal(family.classify(1.9), 'Normal')
  assert.equal(family.classify(1.2 - 1e-12), 'TooRepetitive')
  assert.equal(family.classify(1.9 + 1e-12), 'TooRandom')
})

test('SPEC[degeneration-001] an empty push is a no-op evaluation', () => {
  const detector = Degeneration(envelope()).detector()
  detector.push([1, 2])
  const before = detector.evaluate()
  assert.deepEqual(detector.push([]), before)
})
