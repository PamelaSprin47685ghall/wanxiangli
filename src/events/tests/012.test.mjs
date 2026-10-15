import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { CanonicalEventCodec } from 'wanxiangli/events'

const codec = new CanonicalEventCodec()

const content = Buffer.from('inline payload bytes', 'utf8')
const digest = createHash('sha256').update(content).digest('hex')

const event = (overrides = {}) => ({
  id: 'a'.repeat(40),
  stream: 'job/main',
  type: 'JobRequested',
  parents: [],
  payload: { ref: digest },
  payloadRefs: [digest],
  payloads: { [digest]: new Uint8Array(content) },
  ...overrides,
})

test('WHAT[durable-events-012] inline payload round trip preserves the exact bytes', () => {
  const decoded = codec.tryDecode(codec.encode(event()))
  assert.equal(decoded.ok, true)
  assert.deepEqual(new Uint8Array(decoded.event.payloads[digest]), new Uint8Array(content))
  assert.deepEqual(decoded.event.payloadRefs, [digest])
})

test('WHAT[durable-events-012] a declared payload ref without inline bytes fails decode', () => {
  const missing = { ...event() }
  delete missing.payloads
  const decoded = codec.tryDecode(codec.encode(missing))
  assert.equal(decoded.ok, false)
  assert.equal(decoded.error.code, 'MissingPayload')
  assert.equal(decoded.error.payloadRef, digest)
})

test('WHAT[durable-events-012] a tampered inline payload fails decode on digest mismatch', () => {
  const tampered = Buffer.from(content)
  tampered[0] ^= 0xff
  const decoded = codec.tryDecode(codec.encode(event({ payloads: { [digest]: new Uint8Array(tampered) } })))
  assert.equal(decoded.ok, false)
  assert.equal(decoded.error.code, 'NonCanonical')
  assert.ok(decoded.error.reason.includes('digest mismatch'))
})

test('WHAT[durable-events-012] validate catches payload closure violations without I/O', () => {
  const missing = { ...event() }
  delete missing.payloads
  const missingResult = codec.validate([missing], () => true)
  assert.equal(missingResult.ok, false)
  assert.equal(missingResult.error.code, 'MissingPayload')

  const tampered = Buffer.from(content)
  tampered[1] ^= 0x5a
  const tamperedResult = codec.validate(
    [event({ payloads: { [digest]: new Uint8Array(tampered) } })],
    () => true,
  )
  assert.equal(tamperedResult.ok, false)
  assert.equal(tamperedResult.error.code, 'NonCanonical')
})

test('WHAT[durable-events-012] an empty payload ref set needs no payloads object', () => {
  const bare = event({ payloadRefs: [] })
  delete bare.payloads
  const decoded = codec.tryDecode(codec.encode(bare))
  assert.equal(decoded.ok, true)
  assert.deepEqual(decoded.event.payloads, {})
})
