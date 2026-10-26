import { DatabaseSync } from 'node:sqlite'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { advisorClaim, advisorFinish, advisorPending } from 'wanxiangli/scope-progress'

const [dbPath, action, reportId] = process.argv.slice(2)
const journal = new SqliteJournal(new DatabaseSync(dbPath))
try {
  let result
  if (action === 'claim') result = advisorClaim(journal, 'cross-process', 'scope-one', reportId, 'issue for ' + reportId)
  else if (action === 'finish') result = advisorFinish(journal, 'cross-process', 'scope-one', [reportId], 'Completed')
  else if (action === 'pending') result = advisorPending(journal, 'cross-process', 'scope-one')
  else throw Error('unsupported action')
  process.stdout.write(JSON.stringify(result) + '\n')
} finally { journal.close() }
