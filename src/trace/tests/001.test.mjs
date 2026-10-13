import test from 'node:test'
import assert from 'node:assert/strict'
import { fresh, user, part, finish, bytes, unchanged } from './support.mjs'

test('SPEC[trace-001] first observations allocate consecutive local cursors; replay keeps the original position', () => {
  const trace = fresh()
  const observations = [{ type: 'Opening', bytes: bytes('opening') }, user(), part('user-1', 'first'), finish('user-1')]
  const receipts = observations.map(value => trace.capture(value))
  assert.deepEqual(receipts.map(value => value.cursor), [1, 2, 3, 4])
  for (const index of [3, 1, 0, 2, 1]) {
    assert.deepEqual(trace.capture(observations[index]), { ...receipts[index], status: 'Replayed' })
  }
  assert.equal(trace.inspect().cursor, 4)
  assert.deepEqual(trace.records(), receipts.map(value => value.record))
})

test('SPEC[trace-001] opening cannot be added late or overwritten', () => {
  const trace = fresh()
  trace.capture({ type: 'Opening', bytes: bytes('original') })
  unchanged(trace, () => trace.capture({ type: 'Opening', bytes: bytes('changed') }), /conflict/)
  const without = fresh()
  without.capture(user())
  unchanged(without, () => without.capture({ type: 'Opening', bytes: bytes('late') }), /first/)
})

test('SPEC[trace-001] interleaved messages share a trace but not part indices or part identities', () => {
  const trace = fresh()
  trace.capture(user('a'))
  trace.capture(user('b'))
  trace.capture(part('b', 'B', 0, 'same-part-id'))
  trace.capture(part('a', 'A', 0, 'same-part-id'))
  unchanged(trace, () => trace.capture(part('a', 'missing', 2)), /consecutive/)
  trace.capture(part('a', 'next', 1))
  unchanged(trace, () => trace.capture(part('a', 'reused index', 1, 'different-id')), /consecutive/)
  assert.equal(trace.head().cursor, 5)
})

test('SPEC[trace-001] stable identity binds metadata, kind and every byte, not only its name', () => {
  const trace = fresh()
  trace.capture(user())
  const original = part('user-1', 'original')
  trace.capture(original)
  for (const different of [
    { ...user(), origin: 'plugin' },
    { ...original, bytes: bytes('changed') },
    { ...original, kind: 'binary' },
    { ...original, index: 1 },
  ]) unchanged(trace, () => trace.capture(different), /conflict/)
})

test('SPEC[trace-001] delimiter-like identities do not collide', () => {
  const trace = fresh()
  trace.capture(user('a/b'))
  trace.capture(user('a'))
  trace.capture(part('a/b', 'first', 0, 'c'))
  trace.capture(part('a', 'second', 0, 'b/c'))
  assert.equal(trace.records().length, 4)
})
