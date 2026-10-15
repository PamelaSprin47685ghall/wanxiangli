import test from 'node:test'
import assert from 'node:assert/strict'

import { CanonicalEventCodec } from 'wanxiangli/events'

const codec = new CanonicalEventCodec()

const event = (id, overrides = {}) => ({
  id,
  stream: 'job/main',
  type: 'JobRequested',
  parents: [],
  payload: { note: 'n' },
  payloadRefs: [],
  ...overrides,
})

const id = 'a'.repeat(40)

test('WHAT[durable-events-004] encode ends with exactly one LF', () => {
  const line = codec.encode(event(id))
  assert.ok(line.endsWith('\n'))
  assert.ok(!line.endsWith('\n\n'))
  assert.ok(!line.includes('\r'))
})

test('WHAT[durable-events-004] decode accepts the codec output as-is', () => {
  const decoded = codec.tryDecode(codec.encode(event(id)))
  assert.equal(decoded.ok, true)
  assert.equal(decoded.event.id, id)
})

test('WHAT[durable-events-004] decode rejects a line missing the trailing LF', () => {
  const half = codec.encode(event(id)).trimEnd()
  const decoded = codec.tryDecode(half)
  assert.equal(decoded.ok, false)
  assert.equal(decoded.error.code, 'NonCanonical')
})

test('WHAT[durable-events-004] decode rejects a double trailing LF', () => {
  const doubled = codec.encode(event(id)) + '\n'
  const decoded = codec.tryDecode(doubled)
  assert.equal(decoded.ok, false)
  assert.equal(decoded.error.code, 'NonCanonical')
})

test('WHAT[durable-events-004] decode rejects a CRLF terminator', () => {
  const crlf = codec.encode(event(id)).replace(/\n$/, '\r\n')
  const decoded = codec.tryDecode(crlf)
  assert.equal(decoded.ok, false)
})

test('WHAT[durable-events-004] tryDecodeUtf8Text rejects a UTF-8 BOM', () => {
  const line = codec.encode(event(id))
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(line, 'utf8')])
  const decoded = codec.tryDecodeUtf8Text(withBom)
  assert.equal(decoded.ok, false)
  assert.equal(decoded.error.code, 'NonCanonical')
})

test('WHAT[durable-events-004] tryDecodeUtf8Text rejects invalid UTF-8 sequences', () => {
  const invalid = new Uint8Array([0x22, 0xff, 0xfe, 0x22, 0x0a])
  const decoded = codec.tryDecodeUtf8Text(invalid)
  assert.equal(decoded.ok, false)
  assert.equal(decoded.error.code, 'NonCanonical')
})

test('WHAT[durable-events-004] tryDecodeUtf8 decodes valid bytes and round trips', () => {
  const line = codec.encode(event(id, { payload: { label: '中文' } }))
  const decoded = codec.tryDecodeUtf8(new Uint8Array(Buffer.from(line, 'utf8')))
  assert.equal(decoded.ok, true)
  assert.equal(decoded.event.id, id)
  assert.deepEqual(decoded.event.payload, { label: '中文' })
})
