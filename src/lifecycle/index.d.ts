export type Sequence = readonly ['S1', 'S2', 'S3'] | readonly ['S4'];
export type Stage = 'S1' | 'S2' | 'S3' | 'S4';
export interface Draft { digest: string; path: string }
export type Command =
  | { type: 'Open'; root: string; sequence: Sequence; ownerId: string; openingCursor: number }
  | { type: 'Review'; incumbencyId: string; reviewerId: string; updates: readonly { key: string; value: string | null }[] }
  | { type: 'BindDevOps'; incumbencyId: string; trigger: 'Ask' | 'Resume' | 'Horizon'; devopsId: string; target: string | null }
  | { type: 'Advance'; incumbencyId: string; expected: string; next: string }
  | { type: 'Reopen'; retirementId: string; ownerId: string; openingCursor: number; blockers: readonly string[] }
  | { type: 'Deliver'; incumbencyId: string; providerRunId: string; toolCallId: string; cursor: number; blockers: readonly string[]; nextOwnerId?: string; draft?: Draft }
  | { type: 'ResolveDelivery'; operationId: string; outcome: 'SessionCreated'; execSessionId: string }
  | { type: 'ResolveDelivery'; operationId: string; outcome: 'Accepted'; execSessionId: string; digest: string; path: string; blockers: readonly string[] }
  | { type: 'ResolveDelivery'; operationId: string; outcome: 'NotStarted'; reason: string }
  | { type: 'ResolveDelivery'; operationId: string; outcome: 'Unknown' };
export type Decision =
  | { kind: 'Opened' | 'Reopened'; incumbencyId: string }
  | { kind: 'Reviewed'; outcome: 'Promoted' | 'Stayed'; stage: Stage; firstReview: boolean; obligations: { key: string; value: string }[] }
  | { kind: 'DevOpsBound'; devopsId: string }
  | { kind: 'Advanced'; authority: string }
  | { kind: 'Blocked'; blockerDigest: string }
  | { kind: 'DeliveryRequested'; operationId: string; digest: string; path: string }
  | { kind: 'ObserveExecution'; operationId: string; digest: string; path: string; execSessionId: string | null }
  | { kind: 'ExecutionSessionBound'; operationId: string; execSessionId: string; digest: string; path: string }
  | { kind: 'ExecutionRejected'; operationId: string; reason: string }
  | { kind: 'Delivered'; retirementId: string; incumbencyId: string }
  | { kind: 'Promoted'; stage: Stage; retirementId: string; incumbencyId: string; successorId: string }
  | { kind: 'Authorized'; incumbencyId: string }
  | { kind: 'Relayed'; retirementId: string; incumbencyId: string; successorId: string; autoDispatch: boolean };
export type ExecutionResult =
  | { status: 'Applied'; revision: number; result: Decision; record: string; reason: null }
  | { status: 'Replayed' | 'Observed'; revision: number; result: Decision; record: null; reason: null }
  | { status: 'Conflict'; revision: number; result: null; record: null; reason: string };
export interface Round {
  readonly incumbencyId: string;
  readonly ownerId: string;
  readonly openingStage: Stage;
  readonly closingStage: Stage;
  readonly openingCursor: number;
  readonly retirementCursor: number | null;
  readonly reviewOutcome: 'Promoted' | 'Stayed' | null;
  readonly obligations: { key: string; value: string }[];
  readonly outcome: 'Relayed' | 'Delivered';
  readonly retirementId: string;
}
export interface Snapshot {
  readonly workId: string;
  readonly opened: boolean;
  readonly root: string | null;
  readonly sequence: Sequence | null;
  readonly stage: Stage | null;
  readonly authority: string | null;
  readonly revision: number;
  readonly deliveryAuthorized: boolean;
  readonly active: null | {
    readonly id: string;
    readonly ownerId: string;
    readonly openingStage: Stage;
    readonly openingCursor: number;
    readonly reviewOutcome: 'Promoted' | 'Stayed' | null;
    readonly obligations: { key: string; value: string }[];
  };
  readonly devopsId: string | null;
  readonly canWriteSource: boolean;
  readonly canDispatchDevOps: boolean;
  readonly pendingDelivery: null | { readonly kind: 'ObserveExecution'; readonly operationId: string; readonly digest: string; readonly path: string; readonly execSessionId: string | null };
  readonly rounds: readonly Round[];
}
export type Recovery = { next: 'Open' | 'Review' | 'Continue' | 'ObserveExecution' | 'Done'; state: Snapshot };
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
