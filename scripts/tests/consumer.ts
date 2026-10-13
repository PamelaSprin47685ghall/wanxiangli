import { Work, type Command, type Journal } from 'wanxiangli/work'
import { SqliteJournal, type SqliteConnection } from 'wanxiangli/eventstore'

declare const connection: SqliteConnection
const journal: Journal = new SqliteJournal(connection)
const work = new Work('typed-work', journal)
const command: Command = { type: 'Open', root: 'root', sequence: ['S4'], ownerId: 'manager', openingCursor: 0 }
const response = work.execute('request', command)
if (response.status === 'Committed' && response.result.kind === 'Opened') {
  const tenure: string = response.result.incumbencyId
  work.execute('review', { type: 'Review', incumbencyId: tenure, reviewerId: 'reviewer', findings: [] })
}
const recovery = work.recover()
if (recovery.next !== 'ObserveCommit') {
  const writable: boolean = recovery.state.canWriteSource
  void writable
}

// @ts-expect-error Unknown lifecycle verbs are not public commands.
work.execute('invalid', { type: 'suicide' })
// @ts-expect-error A plan cannot contain an arbitrary sequence.
work.execute('invalid', { type: 'Open', root: 'root', sequence: ['S1'], ownerId: 'manager', openingCursor: 0 })
// @ts-expect-error Findings must be text, not unchecked objects.
work.execute('invalid', { type: 'Review', incumbencyId: 'tenure', reviewerId: 'reviewer', findings: [{}] })
// @ts-expect-error The structural journal must implement atomic append.
new Work('invalid', { read: () => [] })
