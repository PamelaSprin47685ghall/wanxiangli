export type Office = 'Plan' | 'Manager';
export type Milestone =
  | '事实与取舍'
  | '理解与路径'
  | '流程与伪代码'
  | '待执行'
  | '执行'
  | '收尾'
  | '已完成';
export interface Obligation { readonly key: string; readonly value: string }
export interface EffectAsk { readonly kind: 'Ask'; readonly id: string; readonly text: string; readonly incumbencyId: string }
export interface EffectDispatch {
  readonly kind: 'Dispatch';
  readonly id: string;
  readonly promptKind: 'Successor' | 'Advance';
  readonly milestone: string;
  readonly text: string;
  readonly incumbencyId: string;
}
export interface EffectLaunch {
  readonly kind: 'Launch';
  readonly id: string;
  readonly phase: 'Create' | 'Send';
  readonly digest: string;
  readonly providerRunId: string;
  readonly toolCallId: string;
  readonly execSessionId: string | null;
}
export interface EffectStop { readonly kind: 'Stop'; readonly id: string; readonly incumbencyId: string }
export type Effect = EffectAsk | EffectDispatch | EffectLaunch | EffectStop;
export type ConfirmOutcome = 'Parked' | 'Sent' | 'Unknown' | 'Requested' | 'Observed' | 'SessionCreated' | 'Admitted' | 'NotStarted';
export type Command =
  | { type: 'Review'; office: Office; providerRunId: string; toolCallId: string; updates: readonly { key: string; value: string | null }[]; blockers?: readonly string[]; digest?: string }
  | { type: 'OperatorAnswer'; messageId: string }
  | { type: 'OperatorMessage'; kind: 'Operator' | 'Advisor' | 'Agent'; messageId: string }
  | { type: 'ContinueWork'; continuationId: string }
  | { type: 'Confirm'; effectId: string; outcome: ConfirmOutcome; execSessionId?: string; reason?: string }
  | { type: 'BindDevOps'; trigger: 'Ask' | 'Resume' | 'Horizon'; devopsId: string; target: string | null };
export interface Decision {
  readonly kind: string;
  readonly incumbencyId: string | null;
  readonly milestone: string | null;
  readonly wait: string;
  readonly effect: Effect | null;
  readonly obligations: readonly Obligation[];
  readonly successorId?: string;
  readonly retirementId?: string;
  readonly barrierId?: string;
  readonly operationId?: string;
  readonly messageId?: string;
  readonly blockers?: readonly string[];
}
export type ExecutionResult =
  | { status: 'Applied'; revision: number; result: Decision; record: string; reason: null }
  | { status: 'Replayed' | 'Observed'; revision: number; result: Decision; record: null; reason: null }
  | { status: 'Conflict'; revision: number; result: null; record: null; reason: string };
export interface Round {
  readonly incumbencyId: string;
  readonly ownerId: string;
  readonly origin: 'Originator' | 'Successor';
  readonly milestone: string;
  readonly outcome: 'Relayed' | 'Completed';
  readonly retirementId: string;
  readonly providerRunId: string;
  readonly toolCallId: string;
  readonly stopEffectId: string | null;
}
export interface Snapshot {
  readonly workId: string;
  readonly office: Office | null;
  readonly milestone: string | null;
  readonly revision: number;
  readonly phase: string;
  readonly wait: string;
  readonly active: null | {
    readonly id: string;
    readonly ownerId: string;
    readonly origin: 'Originator' | 'Successor';
    readonly milestone: string;
    readonly substantive: boolean;
    readonly obligations: readonly Obligation[];
  };
  readonly rounds: readonly Round[];
  readonly devopsId: string | null;
  readonly devopsTarget: string | null;
  readonly pending: Effect | null;
  readonly launches: readonly { readonly id: string; readonly status: string; readonly digest: string; readonly providerRunId: string; readonly toolCallId: string; readonly execSessionId: string | null }[];
  readonly obligations: readonly Obligation[];
  readonly completed: boolean;
}
export type Recovery = {
  next: 'Review' | 'OperatorAnswer' | 'OperatorMessage' | 'ConfirmEffect';
  wait: 'AwaitReview' | 'AwaitOperatorAnswer' | 'AwaitEmptyReview' | 'AwaitOperatorMessage' | 'ConfirmEffect';
  effect: Effect | null;
  state: Snapshot;
};
export interface Frame {
  readonly requestId: string;
  readonly requestHash: string;
  readonly events: readonly Readonly<Record<string, unknown>>[];
}
export interface Work {
  execute(requestId: string, command: Command): ExecutionResult;
  inspect(): Snapshot;
  history(): Frame[];
  records(): string[];
  recover(): Recovery;
}
export const Work: { new(workId: string, records?: readonly string[]): Work };
export function abandonLocalState(directory: string): void;

/**
 * Autonomous process-lifetime first-bind cell for root workspace path.
 */
export class RootWorkspaceCell {
  constructor();
  TryBind(candidate?: string | null): boolean;
  tryBind(candidate?: string | null): boolean;
  TryRead(): string | undefined;
  tryRead(): string | null;
  Clear(): void;
  clear(): void;
}

export const rootWorkspaceCell: RootWorkspaceCell;

/**
 * Autonomous reference-counted pool for shared workspace event store instances.
 */
export class SharedEventStorePool {
  constructor();
  Acquire<T = any>(commonDir: string, createStore: (commonDir: string) => T): T;
  TryCurrent<T = any>(commonDir: string): T | undefined;
  Release(commonDir: string): boolean;
  SnapshotCount(commonDir: string): number;
  Clear(): void;
}

export const sharedEventStorePool: SharedEventStorePool;

/**
 * Autonomous pool managing asynchronous opening, identity verification,
 * fail-closed pruning on opening rejection, and instance refcount release.
 */
export class SharedAsyncJournalPool {
  constructor();
  AcquireOrStart<T = any>(directory: string, startReady: () => T): [T, boolean];
  SettleSuccess(directory: string, readyTask: any, instance: any): void;
  SettleFailure(directory: string, readyTask: any): void;
  ReleaseTarget<T = any>(target: any): T | undefined;
  SnapshotCount(directory: string): number;
  Clear(): void;
}

export const sharedAsyncJournalPool: SharedAsyncJournalPool;

/**
 * Autonomous process-local single-flight gate for in-flight ask delegations per work.
 */
export class PlanAskGate {
  constructor();
  tryBegin(workId: string): boolean;
  clear(workId: string): void;
  isPending(workId: string): boolean;
  clearAll(): void;
  snapshot(): string[];
}

export const planAskGate: PlanAskGate;
