/**
 * wanxiangli/handle-lifecycle — the single-winner lifecycle of one delegation handle and of
 * one admitted work under it (vibe-fs CUT-13 sub-loop 1; delegation EXEC-004 / EXEC-009).
 *
 * Pure computation. The caller holds the handle and work cells, answers the keyed lookups and
 * value equalities, and writes the phase a `set` verdict names together with its own payload.
 */
export type Phase = 'Active' | 'CompletedAwaitingJoin' | 'Abandoned' | 'Retired'

export interface CompletionShape {
  readonly kind: 'Terminal' | 'SendFailure' | 'Cancelled'
  readonly hasRef: boolean
  readonly hasDigest: boolean
}

export type HandleInput =
  | { readonly event: 'complete' | 'abandon' | 'retire'; readonly phase: Phase | null }
  | {
      readonly event: 'rejectFalseCompletion'
      readonly phase: Phase | null
      /** The cell's completion ref and digest are both present and equal the expected ones. */
      readonly cellMatches: boolean
    }

export type WorkInput =
  | { readonly event: 'abandon' | 'void'; readonly phase: Phase | null; readonly legacy: boolean }
  | { readonly event: 'complete'; readonly phase: Phase | null; readonly legacy: boolean; readonly completion: CompletionShape }
  | {
      readonly event: 'consume'
      readonly phase: Phase | null
      readonly legacy: boolean
      readonly consumptionId: string | null
      readonly expected: CompletionShape
      /** The work's current completion cell equals the expected completion. */
      readonly cellEqualsExpected: boolean
    }

export type Rejection =
  | 'UnknownHandle'
  | 'HandleIsRetired'
  | 'AlreadyCompleted'
  | 'AlreadyAbandoned'
  | 'NotCompleted'
  | 'WorkNotAdmitted'
  | 'ConsumptionMismatch'
  | 'LegacyWorkAmbiguous'

export type Verdict =
  | { readonly verdict: 'set'; readonly phase: Phase }
  | { readonly verdict: 'keep' }
  | { readonly verdict: 'reject'; readonly rejection: Rejection }

export type ObservationKind =
  | 'AbortedObserved' | 'ParentCancelled' | 'DeadlineExceeded' | 'HostSessionGone' | 'RecoveryInFlight' | 'SessionActive'

export type AbandonReason = 'ParentCancelled' | 'DeadlineExceeded' | 'HostSessionGone' | 'Voided'

export interface RecoverChildInput {
  readonly durable: 'Unknown' | 'Active' | 'CompletedAwaitingJoin' | 'Abandoned' | 'Retired'
  /** Required when durable is Abandoned. */
  readonly durableReason?: AbandonReason
  readonly snapshot: 'Missing' | 'Active' | 'Terminal' | 'Unreadable'
  /** For a Terminal snapshot: the host's refusal of the terminal evidence, null when the proof holds. */
  readonly proofError?: string | null
  readonly observations: readonly ObservationKind[]
}

export type ChildResolution =
  | { readonly resolution: 'terminal'; readonly source: 'durable' | 'snapshot' }
  | { readonly resolution: 'abandoned'; readonly reason: AbandonReason; readonly source: 'durable' | 'observation' }
  | { readonly resolution: 'active' }
  | { readonly resolution: 'incomplete' }
  | { readonly resolution: 'blocked'; readonly reason: string }

export declare class HandleLifecycleLaw {
  readonly contractVersion: 1
  handle(input: HandleInput): Verdict
  work(input: WorkInput): Verdict
  recoverChild(input: RecoverChildInput): ChildResolution
}
