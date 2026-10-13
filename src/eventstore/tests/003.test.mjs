import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createJournal, temporary } from './support.mjs'

test('SPEC[eventstore-002] a failure after INSERT but before COMMIT is rolled back as NotWritten', t => {
  const database = temporary(t)
  const journal = createJournal(database)
  t.after(() => journal.close())
  const original = DatabaseSync.prototype.prepare
  try {
    DatabaseSync.prototype.prepare = function (sql) {
      const statement = original.call(this, sql)
      if (!sql.startsWith('INSERT INTO journal_entries')) return statement
      return { run(...args) { statement.run(...args); throw new Error('Injected failure after insert') } }
    }
    assert.equal(journal.append('stream', 0, 'request', 'body').status, 'NotWritten')
  } finally {
    DatabaseSync.prototype.prepare = original
  }
  assert.deepEqual(journal.read('stream'), [])
  assert.equal(journal.append('stream', 0, 'request', 'body').status, 'Committed')
})

for (const afterCommit of [false, true]) {
  test(`SPEC[eventstore-002] exception ${afterCommit ? 'after' : 'at entry to'} COMMIT remains Unknown`, t => {
    const database = temporary(t)
    const journal = createJournal(database)
    const original = DatabaseSync.prototype.exec
    try {
      DatabaseSync.prototype.exec = function (sql) {
        if (sql !== 'COMMIT') return original.call(this, sql)
        if (afterCommit) original.call(this, sql)
        throw new Error('Commit acknowledgement was lost')
      }
      const result = journal.append('stream', 0, 'request', 'body')
      assert.equal(result.status, 'Unknown')
      assert.throws(() => journal.read('stream'), /closed/)
    } finally {
      DatabaseSync.prototype.exec = original
      journal.close()
    }
    const restored = createJournal(database)
    t.after(() => restored.close())
    assert.deepEqual(restored.read('stream'), afterCommit ? ['body'] : [])
  })
}
