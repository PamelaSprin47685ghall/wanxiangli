import test from 'node:test'
import assert from 'node:assert/strict'
import { ProviderCalibration as calibration } from '../../../dist/provider-calibration/ProviderCalibration.js'

test('SPEC[provider-calibration-001] independent readings, replacement and cleanup', () => {
  calibration.clearAll()
  assert.equal(calibration.usage('a'), null)
  assert.equal(calibration.limit('a'), null)
  calibration.recordUsage('a', 7, 11)
  assert.deepEqual(calibration.usage('a'), { cached: 7, uncached: 11 })
  assert.equal(calibration.limit('a'), null)
  calibration.recordLimit('a', 8192)
  assert.equal(calibration.limit('a'), 8192)
  const snapshot = calibration.usage('a')
  snapshot.cached = 50
  assert.deepEqual(calibration.usage('a'), { cached: 7, uncached: 11 })

  calibration.recordUsage('b', 0, 2)
  calibration.recordLimit('b', 16000)
  calibration.recordUsage('a', 3, 4)
  calibration.clearSession('a')
  assert.equal(calibration.usage('a'), null)
  assert.equal(calibration.limit('a'), null)
  assert.deepEqual(calibration.usage('b'), { cached: 0, uncached: 2 })
  assert.equal(calibration.limit('b'), 16000)
  calibration.clearAll()
  assert.equal(calibration.usage('b'), null)
  assert.equal(calibration.limit('b'), null)
})
