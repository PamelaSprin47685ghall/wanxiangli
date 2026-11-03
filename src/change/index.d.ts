export type ChangeTerminal = {kind:'Published';candidate:string;head:string}|{kind:'Failed';reason:string}|{kind:'Abandoned'};
export interface ChangeJobView {
  id:string; session:string; agent:string; byname:string; worktreeIdentity:string; worktreePath:string; target:string; targetBranchFrozen:string;
  candidate:{commit:string}|null;
  conflict:{commit:string;target:string;files:string[];digest:string}|null;
  rebased:{commit:string;target:string}|null;
  claim:{target:string;commit:string;expected:string}|null;
  terminal:ChangeTerminal|null;
}
export type ChangeEvent =
  | {kind:'ManagerJobCreated';id:string;session:string;agent:string;byname:string;worktreeIdentity:string;worktreePath:string;target:string;targetBranchFrozen:string}
  | {kind:'CandidateReady';id:string;commit:string}
  | {kind:'ConflictDetected';id:string;commit:string;target:string;files:string[];digest:string}
  | {kind:'RebasedCandidateReady';id:string;commit:string;target:string}
  | {kind:'PublishClaimed';id:string;target:string;commit:string;expected:string}
  | {kind:'Published';id:string;candidate:string;head:string}
  | {kind:'JobFailed';id:string;reason:string}
  | {kind:'JobAbandoned';id:string}
  | {kind:'WorktreeCreateRequested'|'WorktreeCreated';id:string;identity:string;path:string};
export interface WorktreeEffect {kind:'Requested'|'Created';id:string;path:string}
export type ChangeApplyResult = {ok:true;history:ChangeHistory}|{ok:false;error:'PublishClaimedWithoutRebasedCandidate'|'PublishClaimedCommitMismatch'};
export declare class ChangeHistory {
  constructor();
  apply(event:ChangeEvent):ChangeApplyResult;
  job(id:string):ChangeJobView|null;
  jobBySession(session:string):ChangeJobView|null;
  jobByName(name:string):ChangeJobView|null;
  activeJobs():ChangeJobView[];
  worktreeEffect(identity:string):WorktreeEffect|null;
}

export type ChangeResult<T> = { ok: true; value: T } | { ok: false; error: string };
export interface ChangeVerdict { kind: 'Published' | 'PublishedPendingCleanup' | 'Cancelled' | 'RejectedDirty' | 'IntegrationFailed' | 'Empty'; id: string; head?: string; error?: string }
export interface ChangeJobInput { id: string; target: string; path: string; release(): Promise<ChangeResult<unknown>> }
export interface ChangeCollaborators {
  history(): ChangeHistory;
  append(event: ChangeEvent): Promise<ChangeResult<unknown>>;
  git: {
    readHead(path: string): Promise<ChangeResult<string>>;
    targetHead(target: string): Promise<ChangeResult<string>>;
    conflictedFiles(path: string): Promise<ChangeResult<string[]>>;
    rebase(path: string, target: string): Promise<ChangeResult<unknown>>;
    ffMerge(path: string, target: string, expected: string, candidate: string): Promise<ChangeResult<string>>;
  };
  relay: {
    prepareCandidate(id: string): Promise<ChangeResult<string>>;
    continueLoop(id: string): Promise<ChangeResult<unknown>>;
    awaitSignal(id: string): Promise<ChangeResult<{kind: 'Continue' | 'Candidate' | 'ExceptionalTerminal'; reason?: string}>>;
    terminateResources(id: string): Promise<void>;
  };
  acquireGate(): Promise<{release(): Promise<void>}>;
  sha256(body: string): string;
  isCancellation(error: unknown): boolean;
}
export class ChangeJob { constructor(); run(job: ChangeJobInput, collaborators: ChangeCollaborators): Promise<ChangeVerdict> }
export interface ChangeResource { identity: string; path: string; release(): Promise<ChangeResult<unknown>>; markDurable(): void }
export interface ChangeStart { id: string; agent: string; byname: string; prompt: string; path: string; identity: string; target: string; expectedToolCalls?: number | null }
export interface ChangeRuntimeEffects {
  publication: ChangeCollaborators;
  worktrees: { create(identity: string, path: string, target: string): Promise<ChangeResult<ChangeResource>>; adopt(identity: string, path: string): ChangeResource; list(): Promise<ChangeResult<Array<{path: string; identity: string | null}>>> };
  repoPath: string; durable: boolean;
  isDirty(path: string): Promise<ChangeResult<string[]>>;
  createSession(request: ChangeStart): Promise<ChangeResult<string>>;
  activate(id: string): Promise<ChangeResult<unknown>>;
  startJob(): void;
  publish(verdict: ChangeVerdict): void;
  formatError(error: unknown): string;
}
export class ChangeRuntime {
  constructor(effects: ChangeRuntimeEffects);
  start(request: ChangeStart): Promise<{ok: true; value: {id: string; path: string}} | {ok: false; error: ChangeVerdict}>;
  recover(record: ChangeJobView): void;
}
export class ChangePublication {
  constructor();
  resume(record: ChangeJobView | null): string;
  reenterClaim(target: string, claimTarget: string, commit: string, expected: string, record: ChangeJobView | null): string;
  admitCandidate(commit: string, target: string, rebased: {commit: string; target: string} | null): string;
  certify(commit: string, target: string, rebased: {commit: string; target: string} | null): string;
  checkPublication(id: string, target: string, claimedId: string, claimedTarget: string, expected: string, current: string): string;
  fastForward(merge: ChangeResult<string>, candidate: string, targetMovedError: string): {kind: string; head?: string; error?: string};
  rebaseFailed(files: string[]): string;
  classifyRebased(current: string | null, expected: string): string;
  classifyClaim(current: string | null, candidate: string, expected: string): string;
  reconcile(request: {id: string; identity: string; path: string}, observed: {kind: string; id?: string; path?: string; physical?: ChangeResult<Array<{path: string; identity: string | null}>>}): {kind: string; reason?: string; error?: string};
}
