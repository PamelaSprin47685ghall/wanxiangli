import test from 'node:test'
import assert from 'node:assert/strict'
import { ProviderCalibration as calibration } from '../../../dist/provider-calibration/ProviderCalibration.js'

test('SPEC[provider-calibration-002] interleaved observations agree with an independent session model', () => {
  let seed = 0x1a2b3c4d
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed
  }
  const sessions = Array.from({ length: 17 }, (_, index) => 'session-' + index)
  const usage = new Map()
  const limits = new Map()
  calibration.clearAll()

  for (let step = 0; step < 12000; step++) {
    const session = sessions[next() % sessions.length]
    const action = next() % 8
    if (action <= 2) {
      const cached = next() % 10000
      const uncached = next() % 10000
      calibration.recordUsage(session, cached, uncached)
      usage.set(session, { cached, uncached })
    } else if (action <= 4) {
      const context = 1 + next() % 100000
      calibration.recordLimit(session, context)
      limits.set(session, context)
    } else if (action === 5) {
      calibration.clearSession(session)
      usage.delete(session)
      limits.delete(session)
    } else if (action === 6) {
      calibration.clearAll()
      usage.clear()
      limits.clear()
    }

    for (const sessionId of sessions) {
      assert.deepEqual(calibration.usage(sessionId), usage.get(sessionId) ?? null)
      assert.equal(calibration.limit(sessionId), limits.get(sessionId) ?? null)
    }
  }
  calibration.clearAll()
})
