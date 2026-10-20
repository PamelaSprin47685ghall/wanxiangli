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
}
