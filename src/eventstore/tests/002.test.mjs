import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { createJournal, temporary } from './support.mjs'

test('SPEC[eventstore-003] update and deletion are refused by the actual schema', t => {
  const database = temporary(t)
  const journal = createJournal(database)
  journal.append('stream', 0, 'request', 'original')
  const connection = new DatabaseSync(database)
  t.after(() => { connection.close(); journal.close() })
  assert.throws(() => connection.exec("UPDATE journal_entries SET body=X'6368616e676564'"), /append-only/)
  assert.throws(() => connection.exec('DELETE FROM journal_entries'), /append-only/)
  assert.deepEqual(journal.read('stream'), ['original'])
})

test('SPEC[eventstore-003] checksum corruption rejects the read rather than skipping a row', t => {
  const database = temporary(t)
  const journal = createJournal(database)
  journal.append('stream', 0, 'request', 'original')
  const connection = new DatabaseSync(database)
  t.after(() => { connection.close(); journal.close() })
  connection.exec("DROP TRIGGER journal_no_update; UPDATE journal_entries SET body=X'6368616e676564'")
  assert.throws(() => journal.read('stream'), /checksum mismatch/)
})

test('SPEC[eventstore-003] a missing middle revision is not silently renumbered', t => {
  const database = temporary(t)
  const journal = createJournal(database)
  journal.append('stream', 0, 'first', 'first')
  journal.append('stream', 1, 'second', 'second')
  const connection = new DatabaseSync(database)
  t.after(() => { connection.close(); journal.close() })
  connection.exec('DROP TRIGGER journal_no_delete; DELETE FROM journal_entries WHERE revision=1')
  assert.throws(() => journal.read('stream'), /revision gap/)
  assert.equal(journal.append('stream', 2, 'third', 'third').status, 'NotWritten')
})

test('SPEC[eventstore-003] invalid arguments and excessive UTF-8 bodies fail before a transaction', t => {
  const journal = createJournal(temporary(t))
  t.after(() => journal.close())
  for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => journal.append('stream', revision, 'request', 'body'))
  }
  assert.throws(() => journal.append('', 0, 'request', 'body'))
  assert.throws(() => journal.append('stream', 0, '', 'body'))
  for (const key of ['key\u0000suffix', '\ud800']) {
    assert.throws(() => journal.append(key, 0, 'request', 'body'), /valid text/)
    assert.throws(() => journal.append('stream', 0, key, 'body'), /valid text/)
    assert.throws(() => journal.read(key), /valid text/)
  }
  assert.throws(() => journal.append('stream', 0, 'request', ''))
  assert.throws(() => journal.append('stream', 0, 'request', '\ud800'), /valid UTF-8/)
  assert.throws(() => journal.append('stream', 0, 'request', '界'.repeat(349526)), /1048576/)
  assert.deepEqual(journal.read('stream'), [])
})

test('SPEC[eventstore-003] a native connection is explicit and close is idempotent', t => {
  assert.throws(() => new SqliteJournal('relative.sqlite'), /connection/)
  assert.throws(() => new SqliteJournal({}), /connection/)
  const journal = createJournal(temporary(t))
  journal.close()
  journal.close()
  assert.throws(() => journal.read('stream'), /closed/)
  assert.throws(() => journal.append('stream', 0, 'request', 'body'), /closed/)
})
