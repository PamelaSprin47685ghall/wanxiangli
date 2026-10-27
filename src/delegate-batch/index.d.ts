/** wanxiangli/delegate-batch — SyncDelegate semantic batch admission (EXEC-026/031). Plain data in, frozen plain data out. */

export type DelegateBatchRejection =
  | 'ActiveBatch'
  | 'BatchPending'
  | 'InvalidBatch'
  | 'OtherRunPending'
  | 'DuplicateCall'

export interface DelegateBatchIdentity {
  providerRun: string
  callOrder: readonly string[]
  currentCall: string
}

export interface DelegateBatchPending {
  providerRun: string
  callOrder: readonly string[]
  /** call ids already buffered for this pending batch */
  received: readonly string[]
}

export interface DelegateBatchAdmitInput {
  /** the (owner scope, role) key already has an admitted batch */
  active: boolean
  pending: DelegateBatchPending | null
  /** null for an ungrouped invocation */
  batch: DelegateBatchIdentity | null
}

export type DelegateBatchAdmission =
  | { readonly verdict: 'reject'; readonly reason: DelegateBatchRejection }
  /** ungrouped invocation: admit it alone */
  | { readonly verdict: 'single' }
  /** buffer the invocation; `open` = create the pending batch from this identity first */
  | { readonly verdict: 'wait'; readonly open: boolean }
  /** buffer it, the batch is complete: drop the pending batch and admit `order` */
  | { readonly verdict: 'ready'; readonly open: boolean; readonly order: readonly string[] }

export interface DelegateBatchObservedInput {
  role: string
  currentCall: string
  /** Host-observed tool calls of one ProviderRun, deduplicated, in Host order */
  calls: readonly { role: string; callId: string }[]
}

export declare class DelegateBatchLaw {
  constructor()
  admit(input: DelegateBatchAdmitInput): DelegateBatchAdmission
  /** the role's call ids in Host order when the current call is among them, else null */
  observedBatch(input: DelegateBatchObservedInput): readonly string[] | null
}

export declare class JoinGuardReservationStore {
  constructor()
  nudgeKey(sessionId: string, terminalProviderRun: string): string
  formatKey(sessionId: string, terminalProviderRun: string): string
  createScope(): Set<string>
  tryReserve(
    scope: Set<string> | unknown,
    sessionId: string,
    terminalProviderRun: string,
    hasOutstandingJoinClaim?: boolean | (() => boolean) | null
  ): string | undefined
  release(scope: Set<string> | unknown, key: string): void
  clearSession(sessionId: string, scope?: Set<string> | unknown): void
  clear(scope?: Set<string> | unknown): void
  clearAll(): void
  readonly processCount: number
  snapshot(): readonly string[]
}

export declare const joinGuardReservationStore: JoinGuardReservationStore

export type BatchStage = 'Pending' | 'Ready' | 'Active' | 'Closed'
export type CallStage = 'Dispatched' | 'Closed'

export interface SyncBatchAdmitResult {
  readonly verdict: 'reject' | 'single' | 'wait' | 'ready'
  readonly reason?: DelegateBatchRejection
  readonly invocations?: readonly string[]
}

export interface SyncBatchSettlement {
  readonly cancelledCalls: readonly string[]
  readonly cancelledInvocations: readonly string[]
}

export declare class SyncDelegateBatchStore {
  constructor()
  observeProviderToolCall(ownerSessionId: string, providerRun: string, role: string, callId: string): void
  tryObservedBatch(ownerSessionId: string, providerRun: string, role: string, currentCall: string): readonly string[] | null
  clearSessionObserved(ownerSessionId: string): void
  admit(ownerScope: string, role: string, invocationKey: string, batchObj: DelegateBatchIdentity | null): SyncBatchAdmitResult
  releaseAdmission(ownerScope: string, role: string): void
  beginCall(
    ownerSessionId: string,
    ownerScope: string,
    role: string,
    delegateSessionId: string,
    agent: string,
    invocationKeys: readonly string[],
    callId: string
  ): { ok: true } | { ok: false; error: string }
  tryPeekCallByDelegate(delegateSessionId: string): string | undefined
  tryPopCallByDelegate(delegateSessionId: string): string | undefined
  tryPopExactCall(delegateSessionId: string, callId: string): string | undefined
  cancelScope(ownerScope: string): SyncBatchSettlement
  clearAll(): SyncBatchSettlement
  readonly activeCallsCount: number
  readonly batchesCount: number
  readonly observedRunsCount: number
}

export declare const syncDelegateBatchStore: SyncDelegateBatchStore

export declare class RetiredDelegateRegistry {
  constructor()
  stage(ownerScope: string, delegateSessionId: string): string | undefined
  tryGet(ownerScope: string): string | undefined
  tryTake(ownerScope: string): string | undefined
  clear(ownerScope: string): string | undefined
  clearAll(): readonly string[]
  readonly count: number
  snapshot(): readonly (readonly [string, string])[]
}

export declare const retiredDelegateRegistry: RetiredDelegateRegistry


export interface DeferredCallRecord {
  readonly callId: string
  readonly charge: string
  readonly keywords: string
  readonly estimate: number | null
  readonly stagedAt: number
}

export interface StageDeferredResult {
  readonly ok: boolean
  readonly stagedCount: number
  readonly callId?: string
  readonly reason?: string | null
  readonly existingSession?: string
}

export interface DeferredClearSessionVerdict {
  readonly droppedPending: number
  readonly droppedReplaced: number
}

export interface DeferredClearAllVerdict {
  readonly droppedSessions: number
  readonly droppedPendingCalls: number
  readonly droppedReplacedResults: number
}

export interface DeferredInspectionSnapshot {
  readonly pendingSessionsCount: number
  readonly totalPendingCallsCount: number
  readonly replacedResultsCount: number
}

export declare class DeferredInspectionStore {
  constructor()
  stage(
    sessionId: string,
    callId: string,
    charge: string,
    keywords: string,
    estimate: number | null | undefined
  ): StageDeferredResult
  takePending(sessionId: string): readonly DeferredCallRecord[]
  hasPending(sessionId: string): boolean
  pendingCount(sessionId: string): number
  readonly totalPendingCallsCount: number
  readonly pendingSessionsCount: number
  recordReplacedResult(callId: string, replacement: string, sessionId?: string): boolean
  recordReplacedResults(results: readonly (readonly [string, string])[] | readonly { callId: string; replacement: string }[], sessionId?: string): number
  tryReplacedResult(callId: string): string | undefined
  hasReplacedResults(): boolean
  readonly replacedResultsCount: number
  clearSession(sessionId: string): DeferredClearSessionVerdict
  clearReplacedResults(): number
  clearAll(): DeferredClearAllVerdict
  snapshot(): DeferredInspectionSnapshot
}

export declare const deferredInspectionStore: DeferredInspectionStore
