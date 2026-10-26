import { DatabaseSync } from 'node:sqlite'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { ScopeProgress } from 'wanxiangli/scope-progress'

const [file, checkpoint] = process.argv.slice(2)
const port = ScopeProgress()
port.configureJournal(() => new SqliteJournal(new DatabaseSync(file)))
port.ensureEpoch('killed-session','scope-1')
const baseline = port.record('killed-session','scope-1','provider-1','tool-1',5)
if (!baseline.ok) process.exit(2)
if (checkpoint === 'after-record') process.kill(process.pid, 'SIGKILL')
const first = port.settlePending('killed-session','scope-1')
if (first.length !== 1 || first[0].result.estimate !== 5) process.exit(3)
if (!port.record('killed-session','scope-1','provider-2','tool-2',5).ok) process.exit(4)
const second = port.settle('killed-session','scope-1','provider-2')
if (!second.ok || !second.advisor) process.exit(5)
process.kill(process.pid, 'SIGKILL')
