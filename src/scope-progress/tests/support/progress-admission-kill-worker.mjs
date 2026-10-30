import { DatabaseSync } from 'node:sqlite'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { ScopeProgress } from 'wanxiangli/scope-progress'

const [file] = process.argv.slice(2)
const port = ScopeProgress()
port.configureJournal(() => new SqliteJournal(new DatabaseSync(file)))
port.ensureEpoch('killed-session','scope-1')
const baseline = port.record('killed-session','scope-1','provider-1','tool-1',5)
if (!baseline.ok) process.exit(2)
process.kill(process.pid, 'SIGKILL')
