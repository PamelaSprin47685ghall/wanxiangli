import { DatabaseSync } from 'node:sqlite'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { advisorClaim } from 'wanxiangli/scope-progress'

const journal = new SqliteJournal(new DatabaseSync(process.argv[2]))
const receipt = advisorClaim(journal, 'killed-session', 'scope-1', 'paid-run', 'pay for advice')
if (!receipt.ok || !receipt.accepted) process.exit(2)
process.kill(process.pid, 'SIGKILL')
