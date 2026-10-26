/**
 * wanxiangli/chat-execution — the single-assignment law of one exact managed chat execution
 * (vibe-fs CUT-12; managed-chat-execution: exact key, Accepted → ProviderStarted → Terminal, Terminal single-assigned).
 *
 * Pure computation. The caller owns the evidence (session, run, root, identity seed, provider run), compares it
 * by value, owns the durable projection and the journal append; this law only judges phase transitions.
 */
export type Disposition = 'Completed' | 'Cancelled' | 'Rejected' | 'Failed'
export type PreStartDisposition = 'Cancelled' | 'Rejected' | 'Failed'

export type Phase =
  | { readonly phase: 'Accepted' }
  | { readonly phase: 'ProviderStarted' }
  | { readonly phase: 'EndedBeforeStart'; readonly disposition: PreStartDisposition }
  | { readonly phase: 'EndedAfterStart'; readonly disposition: Disposition }

/** `sameAccepted`: the fact's accepted evidence equals the execution's accepted evidence.
 *  `sameStarted`: the execution has started evidence and it equals the fact's started evidence. */
export type Fact =
  | { readonly kind: 'Accepted'; readonly schemaVersion: number; readonly sameAccepted: boolean }
  | { readonly kind: 'ProviderStarted'; readonly schemaVersion: number; readonly sameAccepted: boolean; readonly sameStarted: boolean }
  | {
      readonly kind: 'Terminal'; readonly schemaVersion: number
      readonly evidence: 'PreProvider' | 'AfterProviderStart'; readonly disposition: Disposition
      readonly sameAccepted: boolean; readonly sameStarted: boolean
    }

export type FoldVerdict =
  | { readonly verdict: 'set'; readonly next: Phase }
  | { readonly verdict: 'keep' }
  | { readonly verdict: 'reject'; readonly reason: string }

export type StartVerdict =
  | { readonly verdict: 'append' | 'existing' | 'providerRunConflict' }
  | { readonly verdict: 'startedAfterTerminal'; readonly established: Disposition }

export type TerminalVerdict =
  | { readonly verdict: 'append' | 'existing' | 'providerNotStarted' | 'providerRunConflict' | 'projectionConflict' }
  | { readonly verdict: 'terminalConflict'; readonly established: Disposition }

export type PreProviderVerdict =
  | { readonly verdict: 'append' | 'existing' | 'invalidDisposition' | 'missingAccepted' | 'evidenceConflict' | 'providerAlreadyStarted' }
  | { readonly verdict: 'terminalConflict'; readonly established: Disposition }

export interface RecoveryInput {
  readonly current: Phase
  readonly provider: 'ReceiptMissing' | 'ReceiptAmbiguous' | 'Absent' | 'Alive' | 'Terminal'
  readonly resource: 'Absent' | 'Held' | 'Released' | 'Unknown'
  readonly persistence: 'Unknown' | 'NoNewWrite' | 'Committed' | 'NotCommitted'
  /** The provider observation names the execution's exact key (true when it names none). */
  readonly providerKeySame: boolean
  /** The resource observation names the execution's exact key. */
  readonly resourceKeySame: boolean
  /** An Alive/Terminal provider observation carries the execution's accepted evidence (true otherwise). */
  readonly providerAcceptedSame: boolean
  /** An Alive/Terminal provider observation carries exactly the execution's started evidence. */
  readonly providerSameAsStarted: boolean
  /** The failure-policy resolution and whether it authorizes exactly this execution / provider run; null when none. */
  readonly policy: null | {
    readonly resolution: 'RetryFreshAttempt' | 'TerminalizeProviderStarted' | 'PreserveCurrentFact' | 'AwaitAcceptanceReconciliation' | 'TerminalizeAcceptedPreProvider'
    readonly matches: boolean
  }
}

export type RecoveryDecision =
  | { readonly decision: 'ignore'; readonly reason: 'DurableTerminalAlreadySettled' | 'ProviderStillAlive' | 'RecoveryAlreadyCommitted' | 'ProviderRecoveryOwned' | 'StalePhysicalEvidence' | 'StalePolicyEvidence' }
  | { readonly decision: 'releaseTerminalResource' | 'persistProviderStarted' | 'persistProviderStartedAndTerminal' | 'resumePreProvider' }
  | { readonly decision: 'finalize'; readonly from: 'observation' | 'policy' }
  | { readonly decision: 'manual'; readonly reason: 'MissingExternalReceipt' | 'AmbiguousExternalReceipt' | 'PhysicalOutcomeUnknown' | 'PersistenceOutcomeUnknown' | 'NoAuthorizedProviderDisposition' }

export declare class ChatExecutionLaw {
  readonly contractVersion: 1
  readonly schemaVersion: 1
  /** null when the schema is folded here, otherwise the rejection reason. */
  schemaRejection(schemaVersion: number): string | null
  /** Fold one durable fact onto the current phase (null = no execution under the exact key yet). */
  fold(current: Phase | null, fact: Fact): FoldVerdict
  /** Provider start; the caller has already matched the accepted evidence. */
  decideStart(current: Phase, sameStarted: boolean): StartVerdict
  /** After-provider terminal; the caller has already matched the accepted evidence. */
  decideTerminal(current: Phase, sameStarted: boolean, disposition: Disposition): TerminalVerdict
  /** Settle an execution that never reached its provider. */
  settlePreProvider(current: Phase | null, sameAccepted: boolean, disposition: Disposition): PreProviderVerdict
  /** Restart recovery: the single next step authorized for one exact execution. */
  recover(input: RecoveryInput): RecoveryDecision
}

export interface QuiescencePermit {
  readonly toJSON: () => never
}

export interface QuiescenceDecision {
  readonly ok: boolean
  readonly reason: 'WrongOwner' | 'NoFreshIdle' | 'AlreadyConsumed' | 'Revoked' | 'Superseded' | null
}

export declare class SessionQuiescenceGate {
  BeginProviderAttempt(sessionId: string): void
  beginProviderAttempt(sessionId: string): void

  BeginToolExecution(sessionId: string): void
  beginToolExecution(sessionId: string): void

  EndToolExecution(sessionId: string): void
  endToolExecution(sessionId: string): void

  ObservePhysicalUserMessage(sessionId: string, physicalUserMessageId: string): void
  observePhysicalUserMessage(sessionId: string, physicalUserMessageId: string): void

  ObserveIdle(sessionId: string): QuiescencePermit
  observeIdle(sessionId: string): QuiescencePermit

  CaptureCurrentAttempt(sessionId: string): QuiescencePermit
  captureCurrentAttempt(sessionId: string): QuiescencePermit

  ObserveIdleFor(observation: unknown): QuiescencePermit | undefined
  observeIdleFor(observation: unknown): QuiescencePermit | undefined

  TryConsume(permit: unknown): QuiescenceDecision
  tryConsume(permit: unknown): QuiescenceDecision

  TryRelease(permit: unknown): QuiescenceDecision
  tryRelease(permit: unknown): QuiescenceDecision

  RevokeCurrentAttempt(sessionId: string): void
  revokeCurrentAttempt(sessionId: string): void

  DropSession(sessionId: string): void
  dropSession(sessionId: string): void

  readonly LivePermitCount: number
  livePermitCount(): number
}

export declare const sessionQuiescenceGate: SessionQuiescenceGate
