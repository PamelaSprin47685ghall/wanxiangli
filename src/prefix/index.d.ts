export type Evidence =
  | { readonly kind: 'compaction'; readonly run: string }
  | { readonly kind: 'tenure'; readonly incumbencyId: string }
  | { readonly kind: 'scope'; readonly callId: string }

/** 非负 int64；number 只接受安全整数，超出安全范围用 bigint。 */
export type Epoch = number | bigint

/** 冻结的世代状态。数组已去重并按序号排序。 */
export interface PrefixState {
  readonly epoch: Epoch
  readonly compactionRuns: readonly string[]
  readonly tenures: readonly string[]
  readonly scopes?: readonly string[]
}

/** 一条待写入的推进行；不改变任何状态。 */
export interface Candidate {
  readonly previousEpoch: Epoch
  readonly nextEpoch: Epoch
  readonly evidence: Evidence
}

export type CommitResult =
  | { readonly ok: true; readonly state: PrefixState }
  | { readonly ok: false; readonly absorbed: true; readonly error: 'StaleEpoch'; readonly expected: Epoch; readonly actual: Epoch }
  | { readonly ok: false; readonly absorbed: true; readonly error: 'AlreadyReanchored'; readonly evidence: Evidence }
  | { readonly ok: false; readonly absorbed: false; readonly error: 'NonSequentialEpoch' }

/** 同代追加律的比较输入。messages 是调用方给出的逐条规范字节。 */
export interface Wire {
  readonly provider: string | null
  readonly model: string | null
  readonly variant: string | null
  readonly tools: readonly string[]
  readonly system: readonly string[]
  readonly messages: readonly string[]
}

export type Break = 'provider' | 'model' | 'variant' | 'tools' | 'system' | 'history-shorter' | 'history-changed'

export declare class Prefix {
  constructor()
  empty(): PrefixState
  normalize(state: PrefixState): PrefixState
  isReanchored(state: PrefixState, evidence: Evidence): boolean
  propose(state: PrefixState, evidence: Evidence): Candidate | null
  proposeCompaction(state: PrefixState, observedRuns: readonly string[]): Candidate | null
  commit(state: PrefixState, candidate: Candidate): CommitResult
  classify(previous: Wire, next: Wire): { readonly append: boolean; readonly breaks: readonly Break[] }
}

export interface ScopeArchive {
  readonly sourceEpoch: bigint
  readonly targetEpoch: bigint
  readonly resetCallId: string
  readonly reference: string
  readonly digest: string
}
export type PrefixHistoryResult = { readonly ok: true; readonly value: PrefixHistory }
  | Exclude<CommitResult, { readonly ok: true }>
/** Immutable owner of the generation, prior Scope archive and question receipts. */
export declare class PrefixHistory {
  constructor(initial?: PrefixState)
  epoch(): bigint
  state(): PrefixState
  hasReanchored(evidence: Evidence): boolean
  reanchored(kind: Evidence['kind']): readonly string[]
  scopeCount(): number
  lastScopeArchive(): ScopeArchive | null
  scopeQuestion(callId: string): string | null
  proposeCompaction(observedRuns: readonly string[]): Candidate | null
  advance(candidate: Candidate): PrefixHistoryResult
  advanceScope(candidate: Candidate & { readonly evidence: { readonly kind: 'scope'; readonly callId: string } }, reference: string | null, digest: string | null): PrefixHistoryResult
  recordScopeQuestion(targetEpoch: bigint, callId: string, digest: string):
    { readonly ok: true; readonly value: PrefixHistory } | { readonly ok: false; readonly error: string }
}
