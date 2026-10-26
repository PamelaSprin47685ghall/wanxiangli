import { Work, type Command, type Decision, type ExecutionResult } from 'wanxiangli/work'
import { SqliteJournal, type SqliteConnection } from 'wanxiangli/eventstore'
import { DurableWork, type Journal } from 'wanxiangli/durable-work'

declare const connection: SqliteConnection
const journal: Journal = new SqliteJournal(connection)
const local = new Work('typed-work')
const command: Command = { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'call-1', updates: [{ key: 'gap', value: 'fix' }] }
const localResult = local.execute('request', command)
if (localResult.status === 'Applied') {
  const body: string = localResult.record
  journal.append('typed-work', 0, 'request', body)
}
if (localResult.status === 'Conflict') {
  const reason: string = localResult.reason
  void reason
  // @ts-expect-error Conflict carries no successful record.
  const badRecord: string = localResult.record
  void badRecord
  // @ts-expect-error Conflict carries no successful result.
  const badResult: Decision = localResult.result
  void badResult
}

function exhaustivelyHandle(res: ExecutionResult): string {
  switch (res.status) {
    case 'Applied': return res.record
    case 'Replayed':
    case 'Observed': return res.result.kind
    case 'Conflict': return res.reason
  }
}
void exhaustivelyHandle
const work = new DurableWork('typed-work', journal)
const response = work.execute('request', command)
if (response.status === 'Committed' && response.result.kind === 'Reviewed' && response.result.incumbencyId) {
  const tenure: string = response.result.incumbencyId
  void tenure
  work.execute('clear', { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'call-2', updates: [{ key: 'gap', value: null }] })
}
const recovery = work.recover()
if (recovery.next !== 'ObserveCommit') {
  const milestone: string | null = recovery.state.milestone
  void milestone
}
new Work('typed-work', work.records())

// @ts-expect-error A local application is not a durable commit.
if (localResult.status === 'Committed') throw new Error('unreachable')
// @ts-expect-error Work accepts records, never a journal service.
new Work('invalid', journal)
// @ts-expect-error Unknown lifecycle verbs are not public commands.
work.execute('invalid', { type: 'suicide' })
// @ts-expect-error A plan cannot contain an arbitrary sequence.
local.execute('invalid', { type: 'Open', root: 'root', sequence: ['S1'], ownerId: 'manager', openingCursor: 0 })
// @ts-expect-error Findings must be text, not unchecked objects.
work.execute('invalid', { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'bad', updates: [{}] })
// @ts-expect-error The composition needs atomic append, not read alone.
new DurableWork('invalid', { read: () => [] })
