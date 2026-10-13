import test from 'node:test'
import assert from 'node:assert/strict'
import { fresh, user, started, assistant, part, finish, message, whole, bytes, capturedUser } from './support.mjs'

test('SPEC[trace-004] a frozen window never sees later parts, message completion or another human message', () => {
  const trace = capturedUser()
  const begin = trace.cut(0)
  trace.capture(started())
  trace.capture(assistant())
  trace.capture(part('assistant-1', 'first'))
  const through = trace.head()
  const before = trace.materialize(begin, through)
  assert.equal(before.statement, null)
  trace.capture(part('assistant-1', 'later', 1))
  trace.capture(finish('assistant-1', 2))
  message(trace, user('new-user'), 'newer user')
  assert.deepEqual(trace.materialize(begin, through), before)
  assert.equal(trace.materialize(begin, through).messages.at(-1).finished, false)
  assert.equal(trace.materialize(begin, trace.head()).statement.content.text, 'firstlater')
})

test('SPEC[trace-004] late parts of a predecessor stay raw observations, not successor messages', () => {
  const trace = capturedUser()
  trace.capture(started())
  trace.capture(assistant('predecessor'))
  const boundary = trace.head()
  trace.capture(part('predecessor', 'late material'))
  trace.capture(finish('predecessor'))
  message(trace, assistant('successor'), 'new work')
  const window = trace.materialize(boundary, trace.head())
  assert.deepEqual(window.messages.map(value => value.messageId), ['successor'])
  assert.equal(window.originals[0].messageId, 'user-1')
  assert.equal(window.statement.messageId, 'successor')
  assert.equal(trace.read(boundary, trace.head())[0].observation.messageId, 'predecessor')
})

test('SPEC[trace-004] last finished assistant prose excludes tools while exact observations retain them', () => {
  const trace = capturedUser()
  trace.capture(started())
  trace.capture(assistant())
  trace.capture(part('assistant-1', '结论\r\n', 0, 'first'))
  trace.capture(part('assistant-1', 'delete files', 1, 'call', 'tool-call'))
  trace.capture(part('assistant-1', '\ufeff原样\u0000', 2, 'second'))
  trace.capture(finish('assistant-1', 3))
  trace.capture({ ...assistant('tool-message'), role: 'tool' })
  trace.capture(part('tool-message', 'not prose', 0, 'result', 'tool-result'))
  trace.capture(finish('tool-message'))
  trace.capture(assistant('unfinished'))
  trace.capture(part('unfinished', 'not a statement yet'))
  const view = whole(trace)
  assert.equal(view.statement.messageId, 'assistant-1')
  assert.deepEqual(view.statement.partIds, ['first', 'second'])
  assert.deepEqual(view.statement.content.bytes, bytes('结论\r\n\ufeff原样\u0000'))
  assert.equal(trace.read(trace.cut(0), trace.head()).some(row => row.observation.content?.text === 'delete files'), true)
})

test('SPEC[trace-004] boundaries reject another trace, another branch, reversal and future cursors', () => {
  const trace = fresh()
  const branch = fresh()
  trace.capture(user('a'))
  branch.capture(user('b'))
  for (const [after, through] of [
    [trace.cut(0), branch.head()], [fresh('foreign').head(), trace.head()],
    [trace.head(), trace.cut(0)], [trace.cut(0), { ...trace.head(), cursor: 2 }],
    [trace.cut(0), { ...trace.head(), digest: 'forged' }],
  ]) assert.throws(() => trace.materialize(after, through))
  for (const invalid of [-1, 0.5, NaN, Infinity, '0', null, 2 ** 32, 1.0001]) assert.throws(() => trace.cut(invalid))
})

test('SPEC[trace-004] empty and exact intervals have explicit exclusive and inclusive boundaries', () => {
  const trace = fresh()
  assert.deepEqual(trace.read(trace.cut(0), trace.head()), [])
  trace.capture(user())
  trace.capture(part('user-1', 'x'))
  assert.deepEqual(trace.read(trace.cut(1), trace.cut(2)).map(value => value.cursor), [2])
  assert.deepEqual(trace.read(trace.cut(2), trace.cut(2)), [])
  assert.deepEqual(trace.materialize(trace.cut(1), trace.cut(2)).messages, [])
  assert.equal(trace.materialize(trace.cut(1), trace.cut(2)).originals[0].parts[0].content.text, 'x')
  assert.equal(trace.materialize(trace.cut(0), trace.cut(0)).opening, null)
})

test('SPEC[trace-004] a statement can join confirmed byte boundaries without replacing invalid source bytes', () => {
  const trace = fresh()
  trace.capture(started())
  trace.capture(assistant())
  trace.capture(part('assistant-1', Uint8Array.of(0xe4, 0xbd)))
  trace.capture(part('assistant-1', Uint8Array.of(0xa0), 1))
  trace.capture(finish('assistant-1', 2))
  const window = whole(trace)
  assert.equal(window.messages[0].parts[0].content.text, null)
  assert.equal(window.statement.content.text, '你')
  assert.deepEqual(window.messages[0].parts[0].content.bytes, Uint8Array.of(0xe4, 0xbd))
})
