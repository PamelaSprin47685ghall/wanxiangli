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

// checkClosure: the strict closure a stored local line must satisfy on append
// and again on retained replay (CUT-19). Unlike decode, no ref is exempt and
// inline bytes nobody references are a fault, because the replay folds every
// inline payload into the content-addressed payload index.
test('WHAT[durable-events-012] checkClosure accepts a self-contained line and a ref-free line', () => {
  const bare = event({ payloadRefs: [], payload: {} })
  delete bare.payloads
  assert.deepEqual(codec.checkClosure([event(), bare], () => true), { ok: true })
})

test('WHAT[durable-events-012] checkClosure names a missing, a tampered and an unreferenced payload distinctly', () => {
  const missing = { ...event() }
  delete missing.payloads
  assert.deepEqual(codec.checkClosure([missing], () => true), {
    ok: false,
    error: { code: 'MissingPayload', payloadRef: digest },
  })

  const tampered = Buffer.from(content)
  tampered[2] ^= 0x01
  assert.deepEqual(codec.checkClosure([event({ payloads: { [digest]: new Uint8Array(tampered) } })], () => true), {
    ok: false,
    error: { code: 'PayloadDigestMismatch', payloadRef: digest },
  })

  // Inline bytes stored under a content address they do not hash to, and named
  // by no ref: decode accepts the line, but a replay that indexes inline
  // payloads by key would serve these bytes for that address.
  const forged = createHash('sha256').update('the bytes a reader asked for').digest('hex')
  const orphan = event({ payloadRefs: [], payload: {}, payloads: { [forged]: new Uint8Array(content) } })
  assert.equal(codec.tryDecode(codec.encode(orphan)).ok, true)
  assert.deepEqual(codec.checkClosure([orphan], () => true), {
    ok: false,
    error: { code: 'UnreferencedPayload', payloadRef: forged },
  })
})

test('WHAT[durable-events-012] checkClosure exempts no ref: a non-content-address ref still needs inline bytes', () => {
  const external = event({ payloadRefs: ['journal-oid-1'], payload: {} })
  delete external.payloads
  assert.equal(codec.tryDecode(codec.encode(external)).ok, true)
  assert.deepEqual(codec.checkClosure([external], () => true), {
    ok: false,
    error: { code: 'MissingPayload', payloadRef: 'journal-oid-1' },
  })
})

test('WHAT[durable-events-027] checkClosure rejects vocabulary over the whole set before any payload fault', () => {
  const missing = { ...event() }
  delete missing.payloads
  const retired = event({ id: 'b'.repeat(40), type: 'IncumbencyRetired', payloadRefs: [], payload: {} })
  delete retired.payloads
  assert.deepEqual(codec.checkClosure([missing, retired], type => type !== 'IncumbencyRetired'), {
    ok: false,
    error: { code: 'UnknownEventType', eventType: 'IncumbencyRetired' },
  })
})

test('WHAT[durable-events-012] checkClosure leaves parents alone: an aged-out parent is not a closure fault', () => {
  const child = event({ parents: ['f'.repeat(40)] })
  assert.deepEqual(codec.checkClosure([child], () => true), { ok: true })
})
