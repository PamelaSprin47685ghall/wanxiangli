import { DatabaseSync } from 'node:sqlite'
import { SqliteJournal } from 'wanxiangli/eventstore'

const [database, mode, body] = process.argv.slice(2)
const journal = new SqliteJournal(new DatabaseSync(database))

if (mode === 'race') {
  process.send({ phase: 'ready' })
  process.once('message', () => {
    const reply = journal.append('race', 0, `request-${process.pid}`, body)
    process.send({ phase: 'result', reply }, () => {
      journal.close()
      process.disconnect()
    })
  })
} else {
  if (mode === 'kill-before-commit') {
    const original = DatabaseSync.prototype.exec
    DatabaseSync.prototype.exec = function (sql) {
      if (sql === 'COMMIT') {
        process.send({ phase: 'before-commit' })
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
      }
      return original.call(this, sql)
    }
  }
  const reply = journal.append('crash', 0, 'crash-request', body)
  process.send({ phase: 'committed', reply })
  setInterval(() => {}, 1000)
}
