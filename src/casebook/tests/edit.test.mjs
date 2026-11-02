import assert from 'node:assert/strict'
import test from 'node:test'
import { BookkeeperStaging } from 'wanxiangli/casebook'

const missing = 'todowrite-for-bookkeeper: no staged transaction'
const value = result => { assert.equal(result.tag, 0); return result.fields[0] }
const fixture = (question = 'Q', answer = 'A', render = key => key) => {
  const staging = new BookkeeperStaging()
  staging.beginTransaction('tx', question, answer)
  return { staging, edit: value(staging.edit('tx', render)) }
}
const program = edit => Function('api', `return new (${edit.runtimeBaseClass})(api)`)(edit.api)
const expectFailure = (run, reason) => assert.throws(run, error => {
  assert.equal(error.message, reason)
  assert.deepEqual(error.__jsFailure, { code: 'PROGRAM_FAILED', reason })
  return true
})

test('case edit keeps its original snapshot and applies both fields only on commit', () => {
  const { staging, edit } = fixture('old Q\r\n', 'old A')
  const api = edit.api.bookkeeper
  assert.deepEqual(api.setQuestion('new Q'), { ok: true })
  assert.deepEqual(api.setAnswer(''), { ok: true })
  assert.equal(api.question(), 'old Q\r\n')
  assert.equal(api.answer(), 'old A')
  assert.deepEqual(value(staging.snapshot('tx')), ['old Q\r\n', 'old A'])
  assert.equal(staging.touched('tx'), false)
  assert.equal(value(edit.commit()), undefined)
  assert.deepEqual(value(staging.take('tx')), ['new Q', ''])
  assert.equal(api.question(), 'old Q\r\n')
})

test('setter failures obtain prose lazily and preserve first-success and error priority', () => {
  const calls = []
  let language = 'first'
  const { staging, edit } = fixture('Q', 'A', key => { calls.push(key); return `${language}:${key}` })
  const api = edit.api.bookkeeper
  assert.deepEqual(calls, [])
  assert.deepEqual(api.setQuestion(7), { ok: false, code: 'PROGRAM_FAILED', reason: 'first:set-question-string' })
  assert.deepEqual(api.setAnswer(null), { ok: false, code: 'PROGRAM_FAILED', reason: 'first:set-answer-string' })
  assert.deepEqual(api.setQuestion(''), { ok: true })
  assert.deepEqual(api.setAnswer('accepted'), { ok: true })
  language = 'next'
  assert.equal(api.setQuestion({}).reason, 'next:set-question-once')
  assert.equal(api.setAnswer(undefined).reason, 'next:set-answer-once')
  assert.deepEqual(calls, ['set-question-string', 'set-answer-string', 'set-question-once', 'set-answer-once'])
  value(edit.commit())
  assert.deepEqual(value(staging.take('tx')), ['', 'accepted'])
})

test('zero-setter edit still touches the current transaction and permits repeated commit', () => {
  const { staging, edit } = fixture()
  value(edit.commit())
  assert.equal(staging.touched('tx'), true)
  staging.beginTransaction('tx', 'replacement Q', 'replacement A')
  assert.equal(staging.touched('tx'), false)
  value(edit.commit())
  assert.deepEqual(value(staging.take('tx')), ['replacement Q', 'replacement A'])
})

test('edits commit to the current same-id slot without overwriting its untouched field', () => {
  const { staging, edit } = fixture('first Q', 'first A')
  edit.api.bookkeeper.setQuestion('patch Q')
  staging.beginTransaction('tx', 'replacement Q', 'replacement A')
  assert.equal(edit.api.bookkeeper.question(), 'first Q')
  value(edit.commit())
  assert.deepEqual(value(staging.snapshot('tx')), ['patch Q', 'replacement A'])
  staging.apply('tx', undefined, 'later A')
  value(edit.commit())
  assert.deepEqual(value(staging.take('tx')), ['patch Q', 'later A'])
})

test('missing transactions keep their error and independent edits retain separate patches', () => {
  const { staging, edit: left } = fixture()
  const right = value(staging.edit('tx', key => key))
  left.api.bookkeeper.setQuestion('left Q')
  right.api.bookkeeper.setAnswer('right A')
  value(left.commit())
  value(right.commit())
  assert.deepEqual(value(staging.take('tx')), ['left Q', 'right A'])
  assert.equal(left.commit().fields[0], missing)
  const absent = staging.edit('missing', () => assert.fail('no prose for missing transaction'))
  assert.equal(absent.tag, 1)
  assert.equal(absent.fields[0], missing)
})

test('aborting the slot prevents commit without destroying the invocation snapshot', () => {
  const { staging, edit } = fixture()
  edit.api.bookkeeper.setAnswer('patch')
  staging.abort('tx')
  assert.equal(edit.commit().tag, 1)
  assert.equal(edit.commit().fields[0], missing)
  assert.equal(edit.api.bookkeeper.answer(), 'A')
  staging.beginTransaction('tx', 'new Q', 'new A')
  value(edit.commit())
  assert.deepEqual(value(staging.take('tx')), ['new Q', 'patch'])
})

test('the runtime view keeps UTF-16 offsets, sequential anchors and original regexp state', () => {
  const { edit } = fixture('A😀B--B\r\nlast', 'answer')
  const runtime = program(edit)
  const pattern = /B/gy
  pattern.lastIndex = 99
  const view = runtime.question([['one', 'afterOne', 'B'], ['two', 'afterTwo', pattern]])
  assert.equal(pattern.lastIndex, 99)
  assert.equal(view.text('one', 'two'), 'B--')
  assert.equal(view.text('^+1', '^+3'), '😀')
  assert.equal(view.text('$-4', '$'), 'last')
  assert.equal(view.text('^+999', '$'), '')
  assert.equal(view.text('^-999', '^+1'), 'A')
  assert.equal(view.text('one+1-1', 'afterOne'), 'B')
  assert.equal(Object.isFrozen(view), true)
  runtime.setQuestion('replacement')
  assert.equal(runtime.question().text(), 'A😀B--B\r\nlast')
  assert.equal(runtime.answer().text(), 'answer')
})

test('zero-width matches keep their actual cursor and offset recursion is clipped at every step', () => {
  const runtime = program(fixture('ab').edit)
  const view = runtime.question([['zero', 'afterZero', /^/gy], ['a', 'afterA', 'a']])
  assert.equal(view.text('zero', 'afterZero'), '')
  assert.equal(view.text('a', 'afterA'), 'a')
  assert.equal(view.text('^-10+1', '$'), 'b')
  assert.equal(runtime.question([[1, 2, 'a']]).text(1, 2), 'a')
})

test('anchor failures retain their order and exact question/answer labels', () => {
  const runtime = program(fixture('abc', 'xyz').edit)
  expectFailure(() => runtime.question([[]]), 'question: each anchor declaration must be [begin, end, pattern]')
  expectFailure(() => runtime.question([['^', 'x', '']]), 'question: invalid anchor names')
  expectFailure(() => runtime.question([['a', 'b', 'a'], ['a', 'c', 'missing']]), 'question: anchor names must be unique')
  expectFailure(() => runtime.question([['a', 'b', '']]), 'question: anchor strings must be non-empty')
  expectFailure(() => runtime.answer([['a', 'b', 3]]), 'answer: anchor pattern must be a string or RegExp')
  expectFailure(() => runtime.answer([['a', 'b', 'missing']]), 'answer: anchor a/b was not found')
  expectFailure(() => runtime.question().text('missing+2'), 'question: unknown anchor missing')
  expectFailure(() => runtime.answer().text('$', '^'), 'answer: $ is after ^')
})
