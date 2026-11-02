import { PrefixHistory, type PrefixHistoryResult, type ScopeArchive } from 'wanxiangli/prefix'
const first = new PrefixHistory({epoch:0n,compactionRuns:[],tenures:[]})
const result: PrefixHistoryResult = first.advanceScope({previousEpoch:0n,nextEpoch:1n,evidence:{kind:'scope',callId:'reset'}},'ref','digest')
if (result.ok) {
  const archive: ScopeArchive | null = result.value.lastScopeArchive()
  const epoch: bigint = result.value.epoch()
  const recorded = result.value.recordScopeQuestion(epoch,'ask','digest')
  if (recorded.ok) { const value: string | null = recorded.value.scopeQuestion('ask'); void value }
  void archive
}
