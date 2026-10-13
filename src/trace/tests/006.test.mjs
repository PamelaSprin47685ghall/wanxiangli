import test from 'node:test'
import assert from 'node:assert/strict'
import { Trace } from 'wanxiangli/trace'
import { capturedUser, fresh, user, part, bytes, whole, unchanged } from './support.mjs'

test('SPEC[trace-006] the generated object contains only message methods, not maps, byte storage or services', () => {
  const trace = capturedUser()
  assert.deepEqual(Object.keys(trace).sort(), ['capture', 'cut', 'head', 'inspect', 'materialize', 'read', 'records'])
  const before = trace.records()
  trace.entries = []
  trace.messages = new Map()
  assert.deepEqual(trace.records(), before)
})

test('SPEC[trace-006] input and every returned view are detached from the next observation', () => {
  const trace = fresh()
  const meta = user()
  trace.capture(meta)
  meta.origin = 'plugin'
  const source = bytes('original')
  trace.capture(part('user-1', source))
  source.fill(0)
  const before = whole(trace)
  const changed = whole(trace)
  changed.originals[0].parts[0].content.bytes.fill(0)
  changed.messages[0].origin = 'plugin'
  trace.read(trace.cut(0), trace.head())[1].observation.content.bytes.fill(1)
  const records = trace.records()
  const restored = new Trace('trace-a', records)
  records.fill('garbage')
  trace.head().cursor = 999
  assert.deepEqual(whole(trace), before)
  assert.deepEqual(whole(restored), before)
})

test('SPEC[trace-006] identical identifiers on different instances do not share state', () => {
  const first = fresh()
  const second = fresh()
  first.capture(user())
  second.capture(user())
  first.capture(part('user-1', 'first'))
  second.capture(part('user-1', 'second'))
  assert.equal(whole(first).originals[0].parts[0].content.text, 'first')
  assert.equal(whole(second).originals[0].parts[0].content.text, 'second')
})

test('SPEC[trace-006] input accessors are rejected without running them', () => {
  const trace = fresh()
  let calls = 0
  const observation = { ...user(), get origin() { calls++; return 'human' } }
  unchanged(trace, () => trace.capture(observation), /accessor/)
  assert.equal(calls, 0)
  for (const value of [null, {}, { ...user(), extra: 1 }, { ...user(), [Symbol('hidden')]: true }]) {
    unchanged(trace, () => trace.capture(value))
  }
})

test('SPEC[trace-006] proxy reentry cannot observe or mutate half a capture', () => {
  const trace = fresh()
  let blocked = false
  const value = new Proxy(user(), {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'type') {
        assert.throws(() => trace.capture(user('intruder')), /reentrant/)
        assert.throws(() => trace.head(), /reentrant/)
        blocked = true
      }
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  trace.capture(value)
  assert.equal(blocked, true)
  assert.equal(trace.inspect().messages, 1)
})

test('SPEC[trace-006] malformed identifiers and numbers cannot allocate records', () => {
  const trace = fresh()
  for (const id of ['', 'a\u0000b', '\ud800', 'x'.repeat(1025), null, 1]) {
    assert.throws(() => new Trace(id))
    unchanged(trace, () => trace.capture(user(id)))
  }
  trace.capture(user())
  for (const index of [-1, 0.5, NaN, Infinity, '0', null, 2 ** 32]) {
    unchanged(trace, () => trace.capture(part('user-1', 'text', index)))
  }
})
