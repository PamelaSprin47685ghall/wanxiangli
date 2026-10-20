import test from 'node:test'
import assert from 'node:assert/strict'
import { Degeneration, envelope } from './support.mjs'

test('SPEC[degeneration-002] a bad token anywhere in a push leaves the statistics untouched', () => {
  const detector = Degeneration(envelope()).detector()
  detector.push([1, 2, 3])
  const before = detector.evaluate()
  for (const bad of [[4, 100], [4, -1], [4, 1.5], [4, '5'], [4, null]]) {
    assert.throws(() => detector.push(bad), /token/)
    assert.deepEqual(detector.evaluate(), before)
    assert.equal(detector.trackedTokenCount(), 3)
  }
  assert.throws(() => detector.push('1 2 3'), /tokens must be an array/)
})

test('SPEC[degeneration-002] state is bounded by the vocabulary, not by output length', () => {
  const detector = Degeneration(envelope({ vocabularySize: 5 })).detector()
  for (let round = 0; round < 2000; round += 1) detector.push([round % 5, (round * 3) % 5])
  assert.equal(detector.trackedTokenCount(), 5)
  assert.equal(detector.evaluate().step, 4000)
})
