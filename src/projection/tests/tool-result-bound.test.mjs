import test from 'node:test'
import assert from 'node:assert/strict'
import { ToolResultBoundStore, toolResultBound } from '../../../dist/projection/Projection.js'

test('SPEC[tool-result-bound-001] default constants and initial limits', () => {
  assert.equal(toolResultBound.defaultHostMaxLines, 2000)
  assert.equal(toolResultBound.defaultHostMaxBytes, 51200)
  assert.equal(toolResultBound.marker, '...head truncated (tail kept)...\n\n')
  assert.equal(toolResultBound.markerBytes, 34)
  assert.equal(toolResultBound.markerLineCost, 2)

  assert.equal(toolResultBound.hostMaxLines(), 2000)
  assert.equal(toolResultBound.hostMaxBytes(), 51200)
  assert.equal(toolResultBound.contentMaxLines(), 1998)
  assert.equal(toolResultBound.contentMaxBytes(), 51166)
})

test('SPEC[tool-result-bound-002] instance isolation between store and singleton', () => {
  const custom = new ToolResultBoundStore()
  custom.setHostLimits(50, 1000)

  assert.equal(custom.hostMaxLines(), 50)
  assert.equal(custom.hostMaxBytes(), 1000)
  assert.equal(custom.contentMaxLines(), 48)
  assert.equal(custom.contentMaxBytes(), 966)

  // Singleton must not be affected
  assert.equal(toolResultBound.hostMaxLines(), 2000)
  assert.equal(toolResultBound.hostMaxBytes(), 51200)
})

test('SPEC[tool-result-bound-003] setHostLimits rejects non-number, non-finite, and values below floor', () => {
  const store = new ToolResultBoundStore()

  // Initial
  assert.equal(store.hostMaxLines(), 2000)
  assert.equal(store.hostMaxBytes(), 51200)

  // Non-number rejected
  store.setHostLimits('500', '10000')
  assert.equal(store.hostMaxLines(), 2000)
  assert.equal(store.hostMaxBytes(), 51200)

  store.setHostLimits(null, undefined)
  assert.equal(store.hostMaxLines(), 2000)
  assert.equal(store.hostMaxBytes(), 51200)

  // Non-finite rejected
  store.setHostLimits(Number.NaN, Number.POSITIVE_INFINITY)
  assert.equal(store.hostMaxLines(), 2000)
  assert.equal(store.hostMaxBytes(), 51200)

  // Values <= floor rejected (markerLineCost = 2, markerBytes = 34)
  store.setHostLimits(2, 34)
  assert.equal(store.hostMaxLines(), 2000)
  assert.equal(store.hostMaxBytes(), 51200)

  store.setHostLimits(1, 33)
  assert.equal(store.hostMaxLines(), 2000)
  assert.equal(store.hostMaxBytes(), 51200)

  store.setHostLimits(-10, -50)
  assert.equal(store.hostMaxLines(), 2000)
  assert.equal(store.hostMaxBytes(), 51200)

  // Valid values strictly above floor accepted
  store.setHostLimits(3, 35)
  assert.equal(store.hostMaxLines(), 3)
  assert.equal(store.hostMaxBytes(), 35)
  assert.equal(store.contentMaxLines(), 1)
  assert.equal(store.contentMaxBytes(), 1)

  // Partial update (one valid, one invalid)
  store.setHostLimits(100, 'invalid')
  assert.equal(store.hostMaxLines(), 100)
  assert.equal(store.hostMaxBytes(), 35)

  store.setHostLimits(null, 5000)
  assert.equal(store.hostMaxLines(), 100)
  assert.equal(store.hostMaxBytes(), 5000)

  // Reset
  store.clearHostLimitsForTests()
  assert.equal(store.hostMaxLines(), 2000)
  assert.equal(store.hostMaxBytes(), 51200)
})

test('SPEC[tool-result-bound-004] fitsInWindow and bound identity under budget', () => {
  const store = new ToolResultBoundStore()
  store.setHostLimits(5, 100)

  assert.equal(store.fitsInWindow(''), true)
  assert.equal(store.fitsInWindow(null), true)
  assert.equal(store.bound(''), '')

  const smallText = 'line1\nline2\nline3'
  assert.equal(store.fitsInWindow(smallText), true)
  assert.equal(store.bound(smallText), smallText)
})

test('SPEC[tool-result-bound-005] truncation by line count keeps tail and satisfies budget', () => {
  const store = new ToolResultBoundStore()
  store.setHostLimits(5, 51200)

  // 10 lines
  const lines = Array.from({ length: 10 }, (_, i) => `row-${i + 1}`).join('\n')
  assert.equal(store.fitsInWindow(lines), false)

  const bounded = store.bound(lines)
  assert.ok(bounded.startsWith(store.marker))

  // Total lines of bounded result must be <= 5
  const boundedLines = bounded.split('\n').length
  assert.ok(boundedLines <= 5, `expected <= 5 lines, got ${boundedLines}`)

  // Tail should be kept (the last rows)
  assert.ok(bounded.endsWith('row-10'))
  assert.ok(bounded.includes('row-9'))
  assert.ok(!bounded.includes('row-1'))
})

test('SPEC[tool-result-bound-006] UTF-8 multi-byte and surrogate pair safe tail truncation', () => {
  const store = new ToolResultBoundStore()
  // Host limit: 10 lines, markerBytes (34) + 10 bytes = 44 bytes
  store.setHostLimits(10, 44)
  assert.equal(store.contentMaxBytes(), 10)

  // Emoji '𠮷' is 4 bytes (𠮷), '中' is 3 bytes, 'a' is 1 byte
  // Construct text with 4-byte surrogate pairs and CJK characters
  const text = 'prefix-long-data-𠮷𠮷𠮷'
  const bounded = store.bound(text)

  assert.ok(bounded.startsWith(store.marker))
  const content = bounded.slice(store.marker.length)
  const contentBytes = Buffer.byteLength(content, 'utf8')
  assert.ok(contentBytes <= 10, `content bytes ${contentBytes} must be <= 10`)

  // Must not have broken surrogate pairs
  assert.equal(/^[\uD800-\uDBFF]$/.test(content[0]), false, 'must not start with isolated high surrogate')
  assert.equal(/^[\uDC00-\uDFFF]$/.test(content[content.length - 1]), false, 'must not end with isolated low surrogate')

  // Verify valid UTF-8 round-trip without replacement characters
  const reencoded = Buffer.from(bounded, 'utf8').toString('utf8')
  assert.equal(reencoded, bounded)
  assert.ok(!bounded.includes('\uFFFD'), 'must not contain replacement characters')
})

test('SPEC[tool-result-bound-007] exact budget matching without fudge factor', () => {
  const store = new ToolResultBoundStore()
  // Set host ceiling: 4 lines, 50 bytes (content budget = 2 lines, 16 bytes)
  store.setHostLimits(4, 50)
  assert.equal(store.contentMaxLines(), 2)
  assert.equal(store.contentMaxBytes(), 16)

  // 4 lines of 10 bytes each = 40 bytes + 3 newlines = 43 bytes
  // Content max is 2 lines, 16 bytes
  const text = '1234567890\nabcdefghij\nklmnopqrst\nuvwxyz1234'
  const bounded = store.bound(text)

  assert.ok(bounded.startsWith(store.marker))
  const totalLines = bounded.split('\n').length
  const totalBytes = Buffer.byteLength(bounded, 'utf8')

  assert.ok(totalLines <= store.hostMaxLines(), `totalLines ${totalLines} must be <= ${store.hostMaxLines()}`)
  assert.ok(totalBytes <= store.hostMaxBytes(), `totalBytes ${totalBytes} must be <= ${store.hostMaxBytes()}`)
})

test('SPEC[tool-result-bound-008] global singleton clearHostLimitsForTests restores clean state', () => {
  toolResultBound.setHostLimits(15, 300)
  assert.equal(toolResultBound.hostMaxLines(), 15)
  assert.equal(toolResultBound.hostMaxBytes(), 300)

  toolResultBound.clearHostLimitsForTests()
  assert.equal(toolResultBound.hostMaxLines(), 2000)
  assert.equal(toolResultBound.hostMaxBytes(), 51200)
})
