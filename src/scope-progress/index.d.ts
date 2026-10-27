export type ProgressReceipt = { ok: boolean; reason?: string; replayed?: boolean; minimum?: number }
export type ProgressSettlement = { ok: boolean; reason?: string; charged?: boolean; estimate?: number; previous?: number | null; advisor?: boolean; trigger?: 'ResetDue' | 'Stall' | null; resetDue?: boolean }
export interface ScopeProgressPort {
  record(sessionId: string, epochId: string, providerRunId: string, toolCallId: string, estimate: number): ProgressReceipt
  settle(sessionId: string, epochId: string, providerRunId: string): ProgressSettlement
  settlePending(sessionId: string, epochId: string): ReadonlyArray<{providerRunId: string, result: ProgressSettlement}>
  reset(sessionId: string, epochId: string): void
  status(sessionId: string): { known: boolean; estimate?: number | null; resetDue: boolean; epoch?: string }
  configureJournal(journalFor: (sessionId: string) => ProgressJournal): void
  bindSessionJournal(sessionId: string, journalFor: (sessionId: string) => ProgressJournal): void
  unbindSessionJournal(sessionId: string): void
  ensureEpoch(sessionId: string, epochId: string): void
  recordedEpoch(sessionId: string, epochId: string): string
  clear(sessionId: string): void
}
export function ScopeProgress(): ScopeProgressPort

export const scopeProgress: ScopeProgressPort

export interface AdvisorProcessQueuePort {
  enqueue(sessionId: string, epochId: string, triggerId: string): {ok: boolean, accepted?: boolean, start?: boolean, processId?: string, triggers?: readonly string[], reason?: string}
  enqueueWithNote(sessionId: string, epochId: string, triggerId: string, note: string): {ok: boolean, accepted?: boolean, start?: boolean, processId?: string, triggers?: readonly string[], notes?: readonly string[], reason?: string}
  hasActive(sessionId: string, epochId: string): boolean
  restoreGroup(sessionId: string, epochId: string, triggerIds: string[], notes: string[]): {ok: boolean, start?: boolean, processId?: string, triggers?: readonly string[], notes?: readonly string[], reason?: string}
  advance(sessionId: string, processId: string, phase: number): {ok: boolean, phase?: number, reason?: string}
  finish(sessionId: string, processId: string): {ok: boolean, start?: boolean, processId?: string, triggers?: readonly string[], reason?: string}
  fail(sessionId: string, processId: string): {ok: boolean, start?: boolean, processId?: string, triggers?: readonly string[], notes?: readonly string[], reason?: string}
  reset(sessionId: string, epochId: string): void
  clear(sessionId: string): void
}
export function AdvisorProcessQueue(): AdvisorProcessQueuePort
export const advisorProcessQueue: AdvisorProcessQueuePort

export type AdvisorReply = { Ok: boolean; Prose: string; Reason: string; ConfirmedFailure?: boolean }
export type AdvisorFlowPorts = {
  AskWorker(sessionId: string, prompt: string): Promise<AdvisorReply>
  AskSeat(sessionId: string, prompt: string): Promise<AdvisorReply>
  SendSteer(sessionId: string, epochId: string, processId: string, prose: string): Promise<AdvisorReply>
  CurrentEpoch(sessionId: string): string
  LanguageFor(sessionId: string): 'en' | 'zh-CN'
  Claim(sessionId: string, epochId: string, reportId: string, issue: string): Promise<{ok: boolean, accepted: boolean, held?: boolean, status?: string, reason?: string}>
  Finish(sessionId: string, epochId: string, reportIds: string[], outcome: 'Completed' | 'Failed'): Promise<{ok: boolean, status?: string, reason?: string}>
  BeginStage(sessionId: string, epochId: string, processId: string, phase: number, question: string, reportIds: string[]): Promise<{ok: boolean, start: boolean, confirmed?: boolean, prose?: string, status: string, reason?: string}>
  ConfirmStage(sessionId: string, epochId: string, processId: string, phase: number, prose: string): Promise<{ok: boolean, status: string, reason?: string}>
  Pending(sessionId: string, epochId: string): Promise<{ok: boolean, pending?: readonly {reportId: string, issue: string}[]}>
}
export interface AdvisorFlowPort {
  trigger(sessionId: string, epochId: string, reportId: string, issue: string): Promise<{ok: boolean, accepted?: boolean, start?: boolean, processId?: string, notes?: readonly string[], reason?: string}>
  resume(sessionId: string, epochId: string): Promise<{ok: boolean, accepted?: boolean, start?: boolean, processId?: string, reason?: string}>
}
export function AdvisorFlow(queue: AdvisorProcessQueuePort, ports: AdvisorFlowPorts): AdvisorFlowPort

export interface AdvisorAdmissionJournal {
  read(stream: string): string[]
  append(stream: string, expectedRevision: number, requestId: string, body: string): {status: string, reason?: string | null}
}
export function advisorClaim(journal: AdvisorAdmissionJournal, sessionId: string, scopeId: string, reportId: string, issue: string): {ok: boolean, accepted: boolean, status: string, reason: string, held: boolean}

export function advisorFinish(journal: AdvisorAdmissionJournal, sessionId: string, scopeId: string, reportIds: string[], outcome: 'Completed' | 'Failed'): {ok: boolean, accepted: boolean, held: boolean, status: string, reason: string}

export function advisorPending(journal: AdvisorAdmissionJournal, sessionId: string, scopeId: string): {ok: boolean, pending?: readonly {reportId: string, issue: string, state: 'Unresolved', group?: {processId: string, reportIds: string[]} | null}[], reason?: string}

export function advisorStageBegin(journal: AdvisorAdmissionJournal, sessionId: string, scopeId: string, processId: string, phase: number, question: string, reportIds: string[]): {ok: boolean, start: boolean, confirmed?: boolean, prose?: string, status: string, reason?: string}
export function advisorStageConfirm(journal: AdvisorAdmissionJournal, sessionId: string, scopeId: string, processId: string, phase: number, prose: string): {ok: boolean, status: string, reason?: string}

export interface ProgressJournal {
  read(stream: string): string[]
  append(stream: string, expectedRevision: number, requestId: string, body: string): {status: string, reason?: string | null}
  close(): void
}
export function durableProgressRecord(journal: ProgressJournal, sessionId: string, epochId: string, providerRunId: string, toolCallId: string, estimate: number): {ok: boolean, minimum?: number, replayed?: boolean, status?: string, reason?: string}
export function durableProgressSettle(journal: ProgressJournal, sessionId: string, epochId: string, providerRunId: string): {ok: boolean, charged?: boolean, estimate?: number, previous?: number | null, advisor?: boolean, trigger?: 'ResetDue' | 'Stall' | null, resetDue?: boolean, replayed?: boolean, status?: string, reason?: string}
export function durableProgressStatus(journal: ProgressJournal, sessionId: string, epochId: string): {ok: boolean, known?: boolean, epoch?: string, estimate?: number | null, resetDue?: boolean, status?: string, reason?: string}
export function durableProgressPending(journal: ProgressJournal, sessionId: string, epochId: string): {ok: boolean, pending?: string[], status?: string, reason?: string}
export function durableProgressDue(journal: ProgressJournal, sessionId: string, epochId: string): {ok: boolean, due?: readonly {providerRunId: string, result: unknown}[], status?: string, reason?: string}
