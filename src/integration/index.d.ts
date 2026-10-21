/**
 * wanxiangli/integration — Change integration law (CUT-23 ②).
 *
 * Commission/manager worktree binding (PERSIST-009), the publish gate's verdicts, conflict
 * ownership and crash-recovery resume (ORCH-007). Pure: the caller runs Git, reads the journal
 * and hands the facts in; every answer is frozen plain JS data. Spawns, writes and waits nothing.
 */

export interface RebasedRecord {
  readonly rebasedCommit: string
  readonly targetHeadSnapshot: string
}

export type WorktreeEvidence =
  | { readonly kind: 'NoDurableEffect' }
  | { readonly kind: 'CreatedReceipt' | 'RequestedConflict'; readonly jobId: string; readonly path: string }
  | {
      readonly kind: 'RequestedEntries'
      readonly jobId: string
      readonly path: string
      readonly entries: readonly { readonly path: string; readonly identity: string | null }[]
    }
  | { readonly kind: 'RequestedQueryFailure'; readonly jobId: string; readonly path: string; readonly error: string }

export type WorktreeDecision =
  | { readonly decision: 'RequestThenCreate' | 'CreateAfterProvenMissing' | 'AdoptThenRecordCreated' | 'AdoptCreated' }
  | { readonly decision: 'Reject'; readonly reason: 'DurableOwnershipConflict' | 'PhysicalIdentityPathConflict' }
  | { readonly decision: 'Reject'; readonly reason: 'WorktreeQueryFailed'; readonly error: string }

export declare class IntegrationLaw {
  readonly contractVersion: 1
  reconcileWorktree(input: {
    readonly jobId: string
    readonly identity: string
    readonly path: string
    readonly evidence: WorktreeEvidence
  }): WorktreeDecision
  rebasedCandidate(input: {
    readonly head: string | null
    readonly rebasedCommit: string
    readonly targetHeadSnapshot: string
  }): { readonly reality: 'HeadUnreadable' | 'PublishReady' | 'NeedsRebase' }
  publishClaim(input: {
    readonly head: string | null
    readonly rebasedCommit: string
    readonly expectedHead: string
  }): { readonly reality: 'HeadUnreadable' | 'AlreadyFastForwarded' | 'PublishReady' | 'ClaimExpired' }
  resume(input: { readonly record: { readonly terminal: boolean; readonly claimed: boolean } | null }): {
    readonly step: 'CleanUp' | 'ReenterClaim' | 'RunLoop'
  }
  reenterClaim(input: {
    readonly jobTargetRef: string
    readonly claim: { readonly targetRef: string; readonly rebasedCommit: string; readonly expectedHead: string }
    readonly record: { readonly rebased: RebasedRecord | null } | null
  }):
    | { readonly step: 'Refuse'; readonly reason: 'TargetMismatch' | 'MissingRecord' | 'MissingRebased' }
    | { readonly step: 'VerifyHead' | 'RunLoop' }
  admitCandidate(input: { readonly candidate: string; readonly target: string; readonly rebased: RebasedRecord | null }):
    | { readonly step: 'PublishCertified' }
    | { readonly step: 'Rebase'; readonly reason: 'TargetAdvanced' | 'InitialRebaseRequired' }
  certify(input: { readonly candidate: string; readonly expectedHead: string; readonly rebased: RebasedRecord | null }):
    | { readonly ok: true }
    | { readonly ok: false; readonly code: 'MissingRebased' | 'CandidatePin' | 'SnapshotPin' }
  rebaseFailed(input: { readonly conflictFiles: readonly string[] }):
    | { readonly step: 'Fail' }
    | { readonly step: 'RecordConflict'; readonly files: readonly string[] }
  checkPublication(input: {
    readonly jobId: string
    readonly jobTargetRef: string
    readonly evidence: { readonly jobId: string; readonly targetRef: string; readonly expectedHead: string }
    readonly current: string
  }): { readonly ok: true } | { readonly ok: false; readonly code: 'JobMismatch' | 'TargetMismatch' | 'CasMismatch' }
  ffMerge(input: {
    readonly merge: { readonly ok: true; readonly landed: string } | { readonly ok: false; readonly error: string }
    readonly candidate: string
    readonly targetMovedError: string
  }):
    | { readonly outcome: 'Landed' | 'LandedMismatch'; readonly landed: string }
    | { readonly outcome: 'TargetMoved' }
    | { readonly outcome: 'Failed'; readonly error: string }
}
