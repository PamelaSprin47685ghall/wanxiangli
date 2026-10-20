import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Degeneration, envelope } from './support.mjs'

test('SPEC[degeneration-003] an invalid envelope is refused at construction', () => {
  assert.throws(() => Degeneration(envelope({ lambda: 1 })), /lambda/)
  assert.throws(() => Degeneration(envelope({ lambda: 0 })), /lambda/)
  assert.throws(() => Degeneration(envelope({ minimumWeightedDistinctCount: 3 })), /must not exceed/)
  assert.throws(() => Degeneration(envelope({ maximumWeightedDistinctCount: Infinity })), /finite/)
  assert.throws(() => Degeneration(envelope({ vocabularySize: 0 })), /vocabularySize/)
  const sneaky = Object.defineProperty(envelope(), 'lambda', { enumerable: true, get: () => 0.5 })
  assert.throws(() => Degeneration(sneaky), /Missing field or accessor: lambda/)
})

test('SPEC[degeneration-003] the published envelope is a frozen copy', () => {
  const input = envelope()
  const family = Degeneration(input)
  input.lambda = 0.9
  assert.equal(family.envelope().lambda, 0.5)
  assert.ok(Object.isFrozen(family.envelope()))
  assert.equal(family.detector().push([1]).weightedDistinctTokens, 1.75)
})

test('SPEC[degeneration-003] reset returns to the prior and detectors are isolated', () => {
  const family = Degeneration(envelope())
  const one = family.detector()
  const two = family.detector()
  one.push(Array(10).fill(1))
  assert.equal(two.evaluate().step, 0)
  one.reset()
  assert.deepEqual(one.evaluate(), { state: 'Normal', isAnomalous: false, weightedDistinctTokens: 1.5, step: 0 })
  assert.equal(one.trackedTokenCount(), 0)
  assert.equal(one.push([1]).weightedDistinctTokens, 1.75, 'no stale last-seen step survives reset')
})

test('SPEC[degeneration-003] the artifact imports no sibling, tokenizer, timer or I/O', () => {
  const artifact = readFileSync(new URL('../../../dist/degeneration/Degeneration.js', import.meta.url), 'utf8')
  assert.doesNotMatch(artifact, /from ["'](wanxiangli\/|node:|gpt-tokenizer)/)
  assert.doesNotMatch(artifact, /\b(setTimeout|setInterval|Date\.now|readFileSync)\b/)
})
