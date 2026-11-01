import { JournalWriter, JournalSession } from 'wanxiangli/journal-session'
import type {
  JournalWriterOptions, WriterFailure, WriterUnavailable, JournalOutcome,
  JournalChange, SessionWriter, JournalFailureOutcome,
} from 'wanxiangli/journal-session'

const options: JournalWriterOptions = {
  initialization: { eventId: 'init', envelope: {} },
  newEventId: () => 'event', now: () => 0,
  makeEnvelope: input => input,
  commitEnvelope: async () => ({ ok: true, value: { cuts: [] } }),
  onSettlement(notice) {
    if (notice.kind === 'initialization-error') {
      const failure: WriterFailure = notice.error
      void failure
    }
  },
}
const writer = new JournalWriter(options)
const outcome: JournalOutcome<WriterFailure, WriterUnavailable> = await writer.append({})
if (outcome.kind === 'Committed') {
  const sequence: bigint = outcome.sequence
  void sequence
}
const session = new JournalSession({
  writer, initialRevision: writer.lastCommittedLocalSeq(),
  readCurrent: () => ({ title: 'current' }),
  refreshCurrent: () => ({ ok: true }),
  onSettlement(result) {
    const failure: JournalFailureOutcome = result
    void failure
  },
})
const appended = await session.append({})
if (appended.kind === 'Committed') {
  const title: string = appended.current.title
  void title
}
const changed: JournalChange | null = await session.awaitChange(0n, cancel => { cancel(); return () => {} })
const snapshot: { current: { title: string }; revision: bigint } = session.snapshotWithRevision()
session.snapshot(); session.revision(); session.refreshCurrent(); session.isPoisoned()
session.enqueueRecovery(async () => {})
await session.runOrAwaitRecovery()
session.release()
await session.releaseAsync()
const protocol: SessionWriter = {
  append: async () => ({ kind: 'CommitUnknown', eventId: 'foreign', error: { original: Symbol('foreign failure') } }),
  isPoisoned: () => false, release() {}, releaseAsync: async () => {},
}
void changed; void snapshot; void protocol
