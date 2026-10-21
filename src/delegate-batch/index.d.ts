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
