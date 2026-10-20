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
