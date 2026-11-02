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

export type DelegateInvocationResult<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: true; readonly mergedInto: string }
  | { readonly ok: false; readonly error: string }

export interface DelegateInvocationRequest<Prompt = unknown, Response = unknown> {
  owner: string
  scope: string
  role: string
  charge: string
  estimate: number | null
  batch: DelegateBatchIdentity | null
  prepare(): Promise<Prompt>
  observed: boolean
  observeAdmission?: ((admission: unknown) => void) | null
  captureResponse?: ((response: Response) => void) | null
  isCancelled(): boolean
  noteDraft: boolean
  /** Caller-owned immutable presentation data. The runtime does not interpret it. */
  data?: unknown
}

export interface DelegateInvocation<Prompt = unknown, Response = unknown> {
  readonly request: DelegateInvocationRequest<Prompt, Response>
  readonly completion: Promise<DelegateInvocationResult<string>>
  cursor: bigint | null
  finish(result: DelegateInvocationResult<string>): void
}

export interface DelegateCall<Prompt = unknown, Response = unknown> {
  readonly owner: string
  readonly scope: string
  readonly role: string
  readonly session: string
  readonly agent: string
  readonly invocations: readonly DelegateInvocation<Prompt, Response>[]
  readonly admission: Promise<string | null>
  readonly answer: Promise<DelegateInvocationResult<string>>
  acceptedPhysical: string | null
  acceptedRoot: string | null
  failureScope: { kind: 'root'; root: string } | { kind: 'continuation'; physical: string } | null
  attach(dispose: () => void): void
  accept(physical: string, notify: () => void): void
  owns(physical: string): boolean
  admit(root: string): void
  finish(result: DelegateInvocationResult<string>): void
  close(): void
}

export interface DelegateInvocationEffects<Prompt = unknown, Response = unknown> {
  attach(request: DelegateInvocationRequest<Prompt, Response>): Promise<{ ok: true; session: string; agent: string } | { ok: false; error: string }>
  cleanupDraft(session: string): void
  replaceEstimate(session: string, estimate: number | null): Promise<void>
  fallbackPrompt(charge: string): Prompt
  combinePrompts(prompts: readonly Prompt[]): Prompt
  resolveAgent(session: string): string | null
  subscribe(call: DelegateCall<Prompt, Response>): () => void
  send(call: DelegateCall<Prompt, Response>, charge: string, prompt: Prompt): Promise<{ ok: true } | { ok: false; error: string }>
  notePrompt(session: string, charge: string): void
  awaitView(call: DelegateCall<Prompt, Response>, answer: Promise<DelegateInvocationResult<string>>): Promise<DelegateInvocationResult<string>>
  awaitInvocation(request: DelegateInvocationRequest<Prompt, Response>, answer: Promise<DelegateInvocationResult<string>>): Promise<DelegateInvocationResult<string>>
}

export interface DelegateTurn<Response = unknown> {
  session: string
  root: string
  physical: string
  outcome: 'completed' | 'aborted' | 'failed' | 'ongoing'
  hasFailure: boolean
  hasParts: boolean
  naturalMaterial: string
  response: Response
  /** Opaque participant inputs returned unchanged to the caller's adapters. */
  original?: unknown
  failure?: unknown
  error?: string
}

export interface DelegateTerminalEffects<Prompt = unknown, Response = unknown> {
  readDelivery(turn: DelegateTurn<Response>): string | null
  noteAnswer(call: DelegateCall<Prompt, Response>, turn: DelegateTurn<Response>, material: string): void
  captureTerminal(turn: DelegateTurn<Response>): Promise<{ kind: 'captured' | 'pending' } | { kind: 'failed'; error: string }>
  retry(call: DelegateCall<Prompt, Response>, turn: DelegateTurn<Response>): Promise<{ ok: true } | { ok: false; error: string }>
}

/** Owns invocation promises, accepted identities, registrations and terminal claims.
 * Uses the existing shared batch and retired registries; it does not isolate their scope.
 */
export declare class DelegateInvocationRuntime<Prompt = unknown, Response = unknown> {
  constructor()
  invoke(request: DelegateInvocationRequest<Prompt, Response>, effects: DelegateInvocationEffects<Prompt, Response>): Promise<DelegateInvocationResult<string>>
  invokeResponse(request: DelegateInvocationRequest<Prompt, Response>, effects: DelegateInvocationEffects<Prompt, Response>): Promise<DelegateInvocationResult<Response | null>>
  invokeObserved<Admission>(request: DelegateInvocationRequest<Prompt, Response>, effects: DelegateInvocationEffects<Prompt, Response>, notDispatched: (reason: string) => Admission): { readonly admission: Promise<Admission>; readonly completion: Promise<DelegateInvocationResult<Response>> }
  handleTurn(turn: DelegateTurn<Response>, effects: DelegateTerminalEffects<Prompt, Response>): Promise<boolean>
  settleCompleted(turn: DelegateTurn<Response>, effects: DelegateTerminalEffects<Prompt, Response>): boolean
  observeTerminal(session: string, observation: { kind: 'failed' | 'aborted'; root: string | null; reason: string; ownAbort: boolean }): void
  observeProviderToolCall(owner: string, run: string, role: string, call: string): void
  tryObservedBatch(owner: string, run: string, role: string, call: string): readonly string[] | undefined
  peek(session: string): DelegateCall<Prompt, Response> | null
  pop(session: string): DelegateCall<Prompt, Response> | null
  popExact(call: DelegateCall<Prompt, Response>): DelegateCall<Prompt, Response> | null
  fail(call: DelegateCall<Prompt, Response>, reason: string): void
  cancelScope(scope: string): void
  takeRetired(scope: string): string | undefined
  getRetired(scope: string): string | undefined
  stageRetired(scope: string, session: string): string | undefined
  clearRetired(scope: string): string | undefined
  clear(): readonly string[]
}
