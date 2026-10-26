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
