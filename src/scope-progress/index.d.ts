// scope-progress — Scope progress ledger. Advisor consultation is removed (2026-10-30):
// no AdvisorFlow, no advisor queue, no claim/stage admission.
// Still product-live: ScopeProgressPort epoch carriers (reset / ensureEpoch / status().epoch /
//   recordedEpoch / bind|unbind / configureJournal / clear).
// Historical only (no product caller may drive these): record / settle / settlePending,
//   estimate, resetDue, durableProgress*. Not a Scope lifecycle entry.
export type ProgressReceipt = { ok: boolean; reason?: string; replayed?: boolean; minimum?: number }
export type ProgressSettlement = { ok: boolean; reason?: string; charged?: boolean; estimate?: number; previous?: number | null; resetDue?: boolean }
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

export interface ProgressJournal {
  read(stream: string): string[]
  append(stream: string, expectedRevision: number, requestId: string, body: string): {status: string, reason?: string | null}
  close(): void
}
export function durableProgressRecord(journal: ProgressJournal, sessionId: string, epochId: string, providerRunId: string, toolCallId: string, estimate: number): {ok: boolean, minimum?: number, replayed?: boolean, status?: string, reason?: string}
export function durableProgressSettle(journal: ProgressJournal, sessionId: string, epochId: string, providerRunId: string): {ok: boolean, charged?: boolean, estimate?: number, previous?: number | null, resetDue?: boolean, replayed?: boolean, status?: string, reason?: string}
export function durableProgressStatus(journal: ProgressJournal, sessionId: string, epochId: string): {ok: boolean, known?: boolean, epoch?: string, estimate?: number | null, resetDue?: boolean, status?: string, reason?: string}
export function durableProgressPending(journal: ProgressJournal, sessionId: string, epochId: string): {ok: boolean, pending?: string[], status?: string, reason?: string}
