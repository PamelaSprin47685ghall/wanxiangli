export type Sequence = readonly ['S1', 'S2', 'S3'] | readonly ['S4'];
export type Stage = 'S1' | 'S2' | 'S3' | 'S4';
export type AppendStatus = 'Committed' | 'Replayed' | 'Conflict' | 'NotWritten' | 'Unknown';
export interface AppendResult {
  status: AppendStatus;
  revision: number;
  reason: string | null;
}
export interface Journal {
  read(stream: string): string[];
  append(stream: string, expectedRevision: number, requestId: string, body: string): AppendResult;
}
export interface Draft { digest: string; path: string }
export type Command =
  | { type: 'Open'; root: string; sequence: Sequence; ownerId: string; openingCursor: number }
  | { type: 'Review'; incumbencyId: string; reviewerId: string; findings: readonly string[] }
  | { type: 'BindDevOps'; incumbencyId: string; trigger: 'Ask' | 'Resume' | 'Horizon'; devopsId: string; target: string | null }
  | { type: 'Advance'; incumbencyId: string; expected: string; next: string }
  | { type: 'Reopen'; retirementId: string; ownerId: string; openingCursor: number; blockers: readonly string[] }
  | { type: 'Deliver'; incumbencyId: string; providerRunId: string; toolCallId: string; cursor: number; blockers: readonly string[]; nextOwnerId?: string; draft?: Draft }
  | { type: 'ResolveDelivery'; operationId: string; outcome: 'Accepted'; execSessionId: string; digest: string; path: string; blockers: readonly string[] }
  | { type: 'ResolveDelivery'; operationId: string; outcome: 'NotStarted'; reason: string }
  | { type: 'ResolveDelivery'; operationId: string; outcome: 'Unknown' };
export type Decision =
  | { kind: 'Opened' | 'Reopened' | 'Confirmed'; incumbencyId: string }
  | { kind: 'Reviewed'; outcome: 'Promoted' | 'Stayed'; stage: Stage; findings: string[] }
  | { kind: 'DevOpsBound'; devopsId: string }
  | { kind: 'Advanced'; authority: string }
  | { kind: 'Blocked'; blockerDigest: string }
  | { kind: 'ReviewRequired' }
  | { kind: 'DispatchExecution' | 'ObserveExecution'; operationId: string; digest: string; path: string }
  | { kind: 'ExecutionRejected'; operationId: string; reason: string }
  | { kind: 'Delivered'; retirementId: string; incumbencyId: string }
  | { kind: 'Relayed'; retirementId: string; incumbencyId: string; successorId: string; autoDispatch: boolean };
export type ExecutionResult =
  | { status: 'Committed' | 'Replayed' | 'Observed'; revision: number; result: Decision; reason: null }
  | { status: 'Conflict' | 'NotWritten' | 'Unknown'; revision: number; result: null; reason: string | null };
export interface Round {
  readonly incumbencyId: string;
  readonly ownerId: string;
  readonly openingStage: Stage;
  readonly closingStage: Stage;
  readonly openingCursor: number;
  readonly retirementCursor: number | null;
  readonly reviewOutcome: 'Promoted' | 'Stayed' | null;
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
    readonly confirmed: boolean;
  };
  readonly devopsId: string | null;
  readonly canWriteSource: boolean;
  readonly canDispatchDevOps: boolean;
  readonly pendingDelivery: null | { readonly kind: 'ObserveExecution'; readonly operationId: string; readonly digest: string; readonly path: string };
  readonly rounds: readonly Round[];
}
export type Recovery =
  | { next: 'Open' | 'Review' | 'Confirm' | 'Continue' | 'ObserveExecution' | 'Done'; state: Snapshot }
  | { next: 'ObserveCommit'; requestId: string; state: null };
export interface Frame {
  readonly requestId: string;
  readonly requestHash: string;
  readonly events: readonly Readonly<Record<string, unknown>>[];
}
export class Work {
  constructor(workId: string, journal: Journal);
  execute(requestId: string, command: Command): ExecutionResult;
  inspect(): Snapshot;
  history(): Frame[];
  recover(): Recovery;
}
