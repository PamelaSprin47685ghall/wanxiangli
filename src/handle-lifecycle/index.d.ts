/**
 * wanxiangli/handle-lifecycle — the single-winner lifecycle of one delegation handle and of
 * one admitted work under it (vibe-fs CUT-13 sub-loop 1; delegation EXEC-004 / EXEC-009).
 *
 * Package-08: JoinAttemptRegistry maintains in-process join lease exclusivity and
 * visible message deduplication facts without async runtime handles.
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
  | 'ParentCancelled' | 'DeadlineExceeded' | 'HostSessionGone' | 'RecoveryInFlight' | 'SessionActive'

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

export interface AcquireVerdict {
  readonly acquired: boolean
  readonly targetSessionId: string
  readonly attemptId: string
  readonly reason: 'AlreadyAcquired' | null
  readonly existingAttemptId?: string
}

export interface ReleaseVerdict {
  readonly released: boolean
  readonly targetSessionId: string
  readonly attemptId: string
}

export interface SignalMessageVerdict {
  readonly woken: boolean
  readonly targetSessionId: string
  readonly attemptId: string | null
  readonly reason: 'UserMessageArrived' | 'DuplicateMessage' | 'NoActiveLease'
  readonly messageId: string
}

export interface ClearSessionVerdict {
  readonly cleared: boolean
  readonly targetSessionId: string
  readonly droppedLease: boolean
  readonly droppedMessagesCount: number
}

export interface JoinAttemptSnapshot {
  readonly targetSessionId: string
  readonly isAcquired: boolean
  readonly attemptId: string | null
  readonly woken: boolean
  readonly seenMessages: readonly string[]
}

export declare class JoinAttemptRegistry {
  acquire(targetSessionId: string, attemptId: string): AcquireVerdict
  release(targetSessionId: string, attemptId: string): ReleaseVerdict
  signalVisibleUserMessage(targetSessionId: string, messageId: string): SignalMessageVerdict
  clearSession(targetSessionId: string): ClearSessionVerdict
  isAcquired(targetSessionId: string): boolean
  hasSeenMessage(targetSessionId: string, messageId: string): boolean
  snapshot(targetSessionId: string): JoinAttemptSnapshot
}

export declare const joinAttemptRegistry: JoinAttemptRegistry

export interface RegisterPendingOptions {
  readonly agentId: string
  readonly token: unknown
  readonly childId?: string | null
  readonly role?: string | null
  readonly payload?: unknown
  readonly subscription?: unknown
}

export interface RegisterPendingVerdict {
  readonly registered: boolean
  readonly agentId: string
  readonly token: unknown
  readonly childId: string
  readonly previousReplaced: boolean
}

export interface ClaimPendingVerdict {
  readonly claimed: boolean
  readonly agentId: string
  readonly token: unknown
  readonly subscription: unknown | null
  readonly payload: unknown | null
  readonly reason: 'NotFound' | 'TokenMismatch' | 'AlreadyFinished' | null
}

export interface SettleCancelledVerdict {
  readonly claimed: boolean
  readonly agentId: string
  readonly token: unknown
  readonly subscription: unknown | null
  readonly payload: unknown | null
  readonly reason: 'NotFound' | 'TokenMismatch' | 'AlreadyFinished' | null
}

export interface RemoveByAgentVerdict {
  readonly removed: boolean
  readonly agentId: string
  readonly token: unknown | null
  readonly subscription: unknown | null
  readonly payload: unknown | null
}

export interface DrainRunItem {
  readonly agentId: string
  readonly token: unknown
  readonly subscription: unknown | null
  readonly payload: unknown | null
}

export interface PendingRunSnapshot {
  readonly agentId: string
  readonly childId: string
  readonly token: unknown
  readonly role: string | null
  readonly finished: boolean
  readonly payload: unknown
}

export declare class PendingRunStore {
  readonly payloadView: any
  rawView(): any
  register(
    agentIdOrOptions: string | RegisterPendingOptions,
    token?: unknown,
    childId?: string,
    role?: string | null,
    payload?: unknown,
    subscription?: unknown
  ): RegisterPendingVerdict
  attachSubscription(agentId: string, token: unknown, subscription: unknown): boolean
  claim(agentId: string, token: unknown): ClaimPendingVerdict
  removeClaimed(agentId: string, token: unknown): boolean
  settleParentCancelled(agentId: string, token: unknown): SettleCancelledVerdict
  removeByAgentId(agentId: string): RemoveByAgentVerdict
  drainAll(): readonly DrainRunItem[]
  drainCancelled(agentIds: readonly string[]): readonly unknown[]
  isFinished(agentId: string, token?: unknown): boolean
  containsAgent(agentId: string): boolean
  tryGetPayload(agentId: string): unknown
  readonly count: number
  activePayloads(): readonly unknown[]
  allPayloads(): readonly unknown[]
  snapshotOutstanding(): readonly PendingRunSnapshot[]
  clear(): void
}

export declare const pendingRunStore: PendingRunStore

export interface CompletedRecordPayload {
  readonly kind: 'completed'
  readonly runId: string
  readonly view: string
  readonly childSessionId: string
  readonly authorityRoot: string
  readonly providerRun: string
  readonly directory: string
}

export interface FailedRecordPayload {
  readonly kind: 'failed'
  readonly runId: string
  readonly code: string
  readonly message: string
  readonly childSessionId: string
}

export type CompletionRecordPayload = CompletedRecordPayload | FailedRecordPayload
export type CompletionRecordOutcome =
  | { readonly kind: 'completed'; readonly runId: string; readonly view: string; readonly childSessionId?: string | null; readonly authorityRoot?: string | null; readonly providerRun?: string | null; readonly directory?: string | null }
  | { readonly kind: 'failed'; readonly runId: string; readonly code: string; readonly message: string; readonly childSessionId?: string | null }
  | { readonly kind: 'abandoned'; readonly runId: string; readonly agentId: string; readonly reason: string }

export interface CompletionRecordError {
  readonly kind: 'MissingSchemaVersion' | 'UnknownSchemaVersion' | 'MissingFinality' | 'UnknownFinality' | 'InvalidJson' | 'IncompletePayload'
  /** The original error detail; empty for a missing schema or finality. */
  readonly reason: string
  readonly message: string
}

export type CompletionRecordDecode =
  | { readonly kind: 'current'; readonly payload: CompletionRecordPayload }
  | { readonly kind: 'legacy-false-abort'; readonly payload: { readonly status: 'aborted'; readonly runId: string; readonly code: string; readonly message: string; readonly childSessionId: string; readonly rawBody: string } }
  | { readonly kind: 'invalid'; readonly error: CompletionRecordError }

export interface CompletionWork {
  readonly childSessionId: string
  readonly authorityRoot: string
}

export type MaterializedCompletion =
  | { readonly kind: 'completed'; readonly runId: string; readonly view: string; readonly childSessionId: string | null; readonly authorityRoot: string | null; readonly providerRun: string | null; readonly directory: string | null }
  | { readonly kind: 'failed'; readonly runId: string; readonly code: string; readonly message: string; readonly childSessionId: string | null }

export type CompletionRecordResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }
export interface CompletionReference { readonly ref: string | null; readonly digest: string | null }
export interface ReadCompletionRecord { readonly body: string; readonly ref: string; readonly digest: string }

/** Schema 4 completion records; storage, handle phase, role and timestamps belong to the caller. */
export declare class CompletionRecord {
  encode(outcome: CompletionRecordOutcome): string
  decode(body: string): CompletionRecordDecode
  belongsToWork(work: CompletionWork, payload: CompletionRecordPayload): boolean
  /** Applies the run-id fallback and turns blank optional identity/directory fields into null. */
  materialize(agentId: string, payload: CompletionRecordPayload): MaterializedCompletion
  decodeForWork(work: CompletionWork | null, agentId: string, body: string): CompletionRecordResult<MaterializedCompletion>
  /** Reads once, checks the digest before decoding, and propagates callback rejection without retry. */
  read(reference: CompletionReference, readBlob: (ref: string) => Promise<CompletionRecordResult<string>>, sha256: (body: string) => string): Promise<CompletionRecordResult<ReadCompletionRecord | null>>
}

/** Process-local child runs. Durable completion and consumption belong to HandleHistory. */
export interface ChildRunOutcome {
  kind: 'completed' | 'failed' | 'abandoned'
  agentId?: string
  runId?: string
  role?: string
  childSessionId?: string | null
  authorityRoot?: string | null
  providerRun?: string | null
  directory?: string | null
  view?: string
  code?: string
  message?: string
  reason?: string
}
export interface ChildRunCompletion {
  readonly runId: string
  readonly agentName: string
  readonly role: string
  readonly outcome: Readonly<ChildRunOutcome>
  readonly completedAt: Date
}
export interface ChildRunInput {
  agentId: string
  agent: string
  role: string
  prompt?: string | null
  run?: ((input: ChildRunInput) => Promise<ChildRunOutcome>) | null
}
export interface ChildRunRecord {
  readonly agentId: string
  readonly agent: string
  readonly role: string
  readonly status: 'Idle' | 'Busy' | 'Interrupted' | 'Closed'
  readonly currentRunId: string | null
  readonly terminalStatusLabel: string | null
  readonly completionCellSettled: boolean
  readonly childSessionId: string | null
}
export interface ChildRunPty { ptyId: string; command: string; startedAt: Date }
export interface ChildRunMailbox<P, I, W> {
  pulseAgent(id: string): void
  publishPty(item: P): void
  pulseWake(): void
  waitForWake(): Promise<W>
  waitForSignal(interrupt: Promise<I>): Promise<W>
  drainAgents(max: number): string[]
  drainPtys(max: number): P[]
  cancel(): boolean
  isCancelled(): boolean
  pendingCount(): number
  pendingPtyCount(): number
}
export declare class ChildRunSet<P = unknown, I = unknown, W = unknown> {
  constructor(options: {
    mailbox: ChildRunMailbox<P, I, W>
    now(): Date
    mintRunId(): string
    raceExit(pending: Promise<unknown>, timeoutMs: number): Promise<boolean>
    runDefault(input: ChildRunInput): Promise<ChildRunOutcome>
    onTerminal?(completion: ChildRunCompletion): void
    cleanup?(agentId: string): void
  })
  fork(input: ChildRunInput): 'Created' | 'Nudged' | 'NotFound'
  restore(input: Omit<ChildRunInput, 'run'>): void
  bindChildSession(id: string, childSessionId: string): void
  cancelAgent(id: string): void
  markInterrupted(id: string, reason: string): void
  awaitAgent(id: string, timeoutMs?: number): Promise<{ok: true; value: ChildRunCompletion} | {ok: false; error: string}>
  list(): {agents: ChildRunRecord[]; ptys: Readonly<ChildRunPty>[]}
  registerPty(pty: ChildRunPty): void
  unregisterPty(id: string): void
  publishPtyCompletion(id: string, item: P): void
  pulseAgentHandle(id: string): void
  pulseWake(): void
  waitForWake(): Promise<W>
  waitForSignal(interrupt: Promise<I>): Promise<W>
  drainAgentWakes(max: number): string[]
  drainPtyCompletions(max: number): P[]
  readonly isCancelled: boolean
  readonly activeRunCount: number
  readonly pendingCompletionCount: number
  readonly pendingPtyCount: number
  close(): void
}

export interface HistoryHandle { kind: number; id: string }
export interface HistoryWork { handle: HistoryHandle; child: string; root: string }
export interface HistoryCell { kind: 'Terminal' | 'SendFailure' | 'Cancelled'; reference: string | null; digest: string | null }
export interface HistoryBinding {
  handle: HistoryHandle; child: string; target: string; byname: string; role: string; parentVisible: boolean;
}
export interface HistoryRecord extends HistoryBinding {
  phase: 'Active' | 'CompletedAwaitingJoin' | 'Abandoned' | 'Retired';
  reason: string | null; completion: HistoryCell | null; lastCompletion: HistoryCell | null;
  work: HistoryWork | null; creationOrder: number;
}
export interface HistoryWorkRecord {
  work: HistoryWork; logicalRun: string; phase: HistoryRecord['phase']; reason: string | null;
  completion: HistoryCell | null; lastCompletion: HistoryCell | null; consumptionId: string | null;
}
export type HistoryResult<T> = { ok: true; value: T } | { ok: false; error: string };
export interface HistoryAdmission {
  parent: string; handle: HistoryHandle;
  profile: { child: string; role: string; target: string; root: string; logicalRun: string; identity: string; owner: string | null } | null;
  landing: { child: string; identity: string; ownerRoot: boolean } | null;
}
export class HandleHistory {
  constructor();
  bindings(): HistoryRecord[];
  works(): HistoryWorkRecord[];
  legacyHandles(): HistoryHandle[];
  readonly nextCreationOrder: number;
  isLegacy(handle: HistoryHandle): boolean;
  binding(handle: HistoryHandle): HistoryRecord | null;
  work(work: HistoryWork): HistoryWorkRecord | null;
  link(binding: HistoryBinding): HistoryResult<HandleHistory>;
  transition(request: { event: 'complete' | 'abandon' | 'retire' | 'rejectFalseCompletion'; handle: HistoryHandle; completion?: HistoryCell; reason?: string }): HistoryResult<HandleHistory>;
  admit(request: HistoryAdmission): HistoryResult<HandleHistory>;
  admitted(work: HistoryWork): HistoryResult<HistoryWorkRecord>;
  transitionWork(request: { event: 'complete' | 'abandon' | 'void' | 'consume'; work: HistoryWork; completion?: HistoryCell; reason?: string; consumptionId?: string }): HistoryResult<HandleHistory>;
  workBindings(): HistoryRecord[];
  summary(handle: HistoryHandle): HistoryRecord | null;
  summaries(): HistoryRecord[];
  byname(byname: string, summarized: boolean): HistoryRecord | null;
  forChild(child: string): HistoryRecord | null;
  deliveryRecords(): HistoryRecord[];
  filterBindings(accept: (summary: HistoryRecord) => boolean): HandleHistory;
  orderedCandidates(): HistoryRecord[];
}

export type DurableHandleResult<T> = { ok: true; value: T } | { ok: false; kind?: 'AppendFailed' | 'NotJoinable' | 'AlreadyRetired' | 'NotFound' | 'TerminalMaterializationFailed'; error: string };
export type DurableHandleFact =
  | { kind: 'link'; binding: HistoryBinding }
  | { kind: 'completeWork' | 'consumeWork'; work: HistoryWork; completion: HistoryCell; consumptionId?: string }
  | { kind: 'abandonWork'; work: HistoryWork; reason: string }
  | { kind: 'retire'; handle: HistoryHandle }
  | { kind: 'rejectFalseCompletion'; handle: HistoryHandle; completion: HistoryCell };
export interface DurableHandleEffects {
  current(): HandleHistory;
  refresh(): DurableHandleResult<unknown>;
  append(fact: DurableHandleFact): Promise<DurableHandleResult<unknown>>;
  writeBlob(body: string): Promise<DurableHandleResult<{ reference: string; digest: string }>>;
  readBlob(reference: string): Promise<DurableHandleResult<string>>;
  sha256(body: string): string;
  mintConsumptionId(): string;
}
export interface DurableHandleDelivery {
  record: HistoryRecord;
  payload?: { kind: 'completed' | 'failed'; runId: string; view?: string; code?: string; message?: string; childSessionId: string | null; authorityRoot?: string | null; providerRun?: string | null; directory?: string | null };
  abandoned?: string;
  runId?: string;
}
export class DurableHandles {
  constructor(effects: DurableHandleEffects);
  orderedCandidates(): HistoryRecord[];
  link(binding: HistoryBinding): Promise<DurableHandleResult<unknown>>;
  complete(request: { work: HistoryWork; logicalRun: string; handle: HistoryHandle; child: string; kind: HistoryCell['kind']; body: string | null }): Promise<DurableHandleResult<unknown>>;
  consume(record: HistoryRecord): Promise<DurableHandleResult<HistoryRecord>>;
  abandon(work: HistoryWork, reason: string): Promise<DurableHandleResult<unknown>>;
  abandonActive(handle: HistoryHandle, reason: string): Promise<DurableHandleResult<unknown>>;
  cancel(handles: HistoryHandle[], reason: string): Promise<DurableHandleResult<unknown>>;
  reconcileFalseAborts(): Promise<DurableHandleResult<unknown>>;
  drain(maxCount: number, accept: (summary: HistoryRecord) => boolean): Promise<DurableHandleResult<DurableHandleDelivery[]>>;
}
