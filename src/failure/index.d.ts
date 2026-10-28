/**
 * wanxiangli/failure — the single decision of one exact execution failure (vibe-fs CUT-14 ①;
 * execution-failure-policy, provider-attempt-recovery).
 *
 * Pure computation. Given the classified failure, the durable lifecycle phase, the exact capacity fence the
 * execution owns and its provider recovery facts, answers the next allowed resolution, the breaker transition,
 * the fence settlement and whether the process must stop after settlement. The caller executes and confirms
 * every effect (physical retry, cleanup, fatal). `executionKey` and `capacityFence` are opaque and handed back
 * by reference.
 */
export type PersistenceCommitment = 'NotCommitted' | 'Committed' | 'Unknown' | 'NoNewWrite'

export type FailureKind =
  | 'LocalInvariant' | 'ProtocolRejection' | 'AuthorizationDenied' | 'UserCancelled' | 'Superseded'
  | 'CapacityQueueFull' | 'ProviderTransient' | 'ProviderPermanent' | 'AcceptanceUnknown'
  | 'StreamInterruptedAfterFirstToken'

export type Failure =
  | FailureKind
  | { readonly kind: FailureKind }
  | { readonly kind: 'PersistenceFailure'; readonly commitment: PersistenceCommitment }

export type Phase = 'NoAcceptedFact' | 'AcceptedBeforeProvider' | 'ProviderStarted' | 'Terminal'

export interface ProviderRecoveryFacts {
  readonly logicalRun: string
  readonly providerRun: string
  readonly requestKind: 'WorkMain' | 'InteractionRepair'
  readonly retryBudget: 'Available' | 'Exhausted'
  readonly breaker: 'Closed' | 'Open'
}

export interface FailureInput<K, F> {
  readonly failure: Failure
  readonly phase: Phase
  readonly executionKey: K
  /** null/undefined: the execution owns no exact fence. */
  readonly capacityFence?: F | null
  /** Required only when a provider failure happened after the provider started. */
  readonly provider?: ProviderRecoveryFacts | null
}

export interface RecoveryAuthorization {
  /** Length-prefixed `logicalRun|providerRun|requestKind`. */
  readonly decisionId: string
  readonly logicalRun: string
  readonly providerRun: string
  readonly requestKind: 'WorkMain' | 'InteractionRepair'
}

export interface FailureDecision<K, F> {
  readonly resolution:
    | 'PreserveCurrentFact' | 'AwaitAcceptanceReconciliation' | 'RetryFreshAttempt'
    | 'TerminalizeAcceptedPreProvider' | 'TerminalizeProviderStarted'
  /** The input key for AwaitAcceptanceReconciliation and both Terminalize resolutions, else null. */
  readonly executionKey: K | null
  readonly terminalDisposition: 'Cancelled' | 'Rejected' | 'Failed' | null
  readonly authorization: RecoveryAuthorization | null
  readonly breaker: 'NoBreakerTransition' | 'RecordProviderTransientFailure' | 'RecordProviderPermanentFailure'
  readonly capacitySettlement: 'NoCapacitySettlement' | 'RetainExactFence' | 'ReleaseExactFence'
  /** The input fence when retained or released, else null. */
  readonly capacityFence: F | null
  readonly fatality: 'NoFatality' | 'FatalAfterSettlement'
}

export declare class ExecutionFailurePolicy {
  constructor()
  readonly contractVersion: 1
  /** Throws on malformed input; never guesses a missing fact. */
  decide<K, F>(input: FailureInput<K, F>): FailureDecision<K, F>
}

export type RegisterResult = 'Admitted' | 'AlreadyStopped'

export type WaitForStopResult = 'Stopped' | 'TimedOut' | 'Denied'

export interface ProviderAttemptStopFenceSnapshot {
  readonly stopped: number
  readonly waiting: number
  readonly denied: number
}

export declare class ProviderAttemptStopFence {
  constructor()
  Register(sessionId: string, providerRun: string): RegisterResult
  SignalStop(sessionId: string, providerRun: string): void
  WaitForStop(sessionId: string, providerRun: string, timeoutMs?: number): Promise<WaitForStopResult>
  Revoke(sessionId: string): void
  Clear(sessionId: string): void
  ClearAll(): void
  Snapshot(): ProviderAttemptStopFenceSnapshot
}

export declare const providerAttemptStopFence: ProviderAttemptStopFence

export type PendingAdmissionResult<T = unknown> =
  | { readonly kind: 'Admitted'; readonly plan: T }
  | { readonly kind: 'ReplayedExisting'; readonly existing: T }
  | { readonly kind: 'IdentityMismatch'; readonly expectedSession: string; readonly expectedPhysical: string; readonly attempted: T }
  | { readonly kind: 'PlanConflict'; readonly existing: T; readonly attempted: T }

export interface RecoveryAttemptPlanStoreSnapshot {
  readonly pendingCount: number
  readonly boundCount: number
  readonly interventionCount: number
}

export declare class RecoveryAttemptPlanStore {
  constructor()
  FreezePending<T = unknown>(
    sessionId: string,
    physicalUserMessageId: string,
    planSessionId: string,
    planPhysicalUserMessageId: string,
    plan: T,
    isEqual?: (existing: T, attempted: T) => boolean
  ): PendingAdmissionResult<T>
  TryPending<T = unknown>(sessionId: string, physicalUserMessageId: string): T | null
  TryAttemptPlan<T = unknown>(sessionId: string, providerRun: string): T | null
  TryBindAttemptPlan<T = unknown, B = unknown>(
    sessionId: string,
    physicalUserMessageId: string,
    providerRun: string,
    bindFn: (pending: T) => B
  ): B | null
  BindAttemptPlan<T = unknown, B = unknown>(
    sessionId: string,
    physicalUserMessageId: string,
    providerRun: string,
    bindFn: (pending: T) => B,
    ordinary: T
  ): B
  ConsumeAttemptPlan<T = unknown>(sessionId: string, providerRun: string): T | null
  PublishManualIntervention<T = unknown>(sessionId: string, physicalUserMessageId: string, request: T): void
  ManualInterventions<T = unknown>(): T[]
  RevokeManualIntervention(sessionId: string, physicalUserMessageId: string): void
  ClearSession(sessionId: string): void
  ClearAttemptPlansFor(keyPrefix: string): void
  Snapshot(): RecoveryAttemptPlanStoreSnapshot
}

export declare const recoveryAttemptPlanStore: RecoveryAttemptPlanStore
