import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SqliteJournal } from 'wanxiangli/eventstore'

test('SPEC[eventstore-005] the exported object does not expose its native connection or latches', t => {
  const journal = new SqliteJournal(new DatabaseSync(':memory:'))
  t.after(() => journal.close())
  assert.deepEqual(Object.keys(journal).sort(), ['append', 'close', 'read'])
  assert.equal(journal.database, undefined)
  assert.equal(journal.closed, undefined)
  assert.equal(journal.execute, undefined)
  for (const value of Object.values(journal)) assert.equal(typeof value, 'function')
})

test('SPEC[eventstore-005] native callbacks cannot read uncommitted rows or close an active transaction', t => {
  const database = new DatabaseSync(':memory:')
  const journal = new SqliteJournal(database)
  t.after(() => journal.close())
  const execute = database.exec.bind(database)
  let inspected = false
  database.exec = sql => {
    if (sql === 'COMMIT') {
      inspected = true
      assert.throws(() => journal.read('stream'), /reentrant/)
      assert.throws(() => journal.append('stream', 1, 'nested', 'nested'), /reentrant/)
      assert.throws(() => journal.close(), /reentrant/)
    }
    return execute(sql)
  }
  assert.equal(journal.append('stream', 0, 'first', 'body').status, 'Committed')
  assert.equal(inspected, true)
  assert.deepEqual(journal.read('stream'), ['body'])
  assert.equal(journal.append('stream', 1, 'second', 'next').status, 'Committed')
})
