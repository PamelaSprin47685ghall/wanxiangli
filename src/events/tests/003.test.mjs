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

test('WHAT[durable-events-003] encode is deterministic and independent of input key order', () => {
  const first = codec.encode(event('a'.repeat(40), { payload: { b: 2, a: 1, c: 3 } }))
  const second = codec.encode(event('a'.repeat(40), { payload: { c: 3, b: 2, a: 1 } }))
  assert.equal(first, second)
})

test('WHAT[durable-events-003] canonical JSON sorts keys by Unicode code point, not locale', () => {
  const value = { '2': 'two', '10': 'ten', '\u{10000}': 'astral', '\uE000': 'pua' }
  const text = codec.canonicalJson(value)
  // 主仓 durable-events-003 权威语义：键按码点排序，JSON.stringify 输出原始字符，
  // 不做 \u 转义（BMP 私有区与增补面字符均原样输出）。
  assert.equal(
    text,
    '{"10":"ten","2":"two","\uE000":"pua","\u{10000}":"astral"}',
  )
})

test('WHAT[durable-events-003] canonical JSON encodes sparse array holes as null', () => {
  const sparse = [1, , 3]
  assert.equal(codec.canonicalJson(sparse), '[1,null,3]')
})

test('WHAT[durable-events-003] same id with different bytes fails checkIdentity and mergeByIdentity', () => {
  const left = event('a'.repeat(40), { payload: { note: 'left' } })
  const right = event('a'.repeat(40), { payload: { note: 'right' } })

  const identity = codec.checkIdentity(left, right)
  assert.equal(identity.ok, false)
  assert.equal(identity.error.code, 'IdentityCollision')
  assert.equal(identity.error.eventId, 'a'.repeat(40))

  const merged = codec.mergeByIdentity([left, right])
  assert.equal(merged.ok, false)
  assert.equal(merged.error.code, 'IdentityCollision')
})

test('WHAT[durable-events-003] identical duplicates collapse; distinct ids are all retained', () => {
  const id = 'a'.repeat(40)
  const other = 'b'.repeat(40)
  // same id, same bytes, but set-shaped fields given in different order
  const first = event(id, { parents: ['c'.repeat(40), 'd'.repeat(40)], payloadRefs: [] })
  const second = event(id, { parents: ['d'.repeat(40), 'c'.repeat(40)], payloadRefs: [] })

  const identity = codec.checkIdentity(first, second)
  assert.deepEqual(identity, { ok: true })

  const merged = codec.mergeByIdentity([first, second, event(other)])
  assert.equal(merged.ok, true)
  assert.equal(merged.events.length, 2)
  assert.deepEqual(
    merged.events.map(item => item.id).sort(),
    [id, other],
  )
})

test('WHAT[durable-events-003] encode/decode round trip preserves event semantics', () => {
  const source = event('a'.repeat(40), { parents: ['b'.repeat(40)], payload: { deep: { x: [1, 2] } } })
  const decoded = codec.tryDecode(codec.encode(source))
  assert.equal(decoded.ok, true)
  assert.equal(decoded.event.id, source.id)
  assert.equal(decoded.event.stream, source.stream)
  assert.equal(decoded.event.type, source.type)
  assert.deepEqual(decoded.event.parents, source.parents.sort())
  assert.deepEqual(decoded.event.payload, source.payload)
})
