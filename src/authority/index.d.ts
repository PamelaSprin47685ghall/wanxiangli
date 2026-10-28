/**
 * wanxiangli/authority — 逻辑根注册、精确关闭与来源解析优先级的纯决议（CUT-09 子范围①）。
 *
 * 无状态。投影记录、事实编解码与 durable 写入归宿主。畸形输入抛错，不猜测。
 * D-01：无法证明的来源一律 UnknownOrigin（失败关闭），纯计算从不推断 HumanRoot。
 */

export type RootKind = 'HumanRoot' | 'AgentOwnerRoot'

export interface RunRoot {
  sessionId: string
  logicalRunId: string
  rootId: string
  kind: RootKind
  /** 宿主给出的身份种子规范键；只做逐字相等比较。 */
  seed: string
}

export type Origin =
  | { kind: 'AuthorityRoot'; root: RootKind }
  | { kind: 'Continuation'; continuation: string }
  | { kind: 'HostInternal' }
  | { kind: 'UnknownOrigin' }

export type Registration = 'admit' | 'replay' | 'conflict'
export type Closure = 'close' | 'already-closed' | 'mismatch' | 'no-authority' | 'not-child-work'

export interface OriginInput {
  acceptedContinuation?: string | null
  claimOrigin?: Origin | null
  hasPromptKey: boolean
  hostCompaction: boolean
  activeKind?: RootKind | null
}

/** 入口准入的输入（CUT-09-a）。全部是宿主已观察到的事实；participant 解析与身份种子由宿主完成。 */
export interface AdmissionInput {
  sessionId?: string | null
  physicalId?: string | null
  promptKey?: string | null
  /** 线上原样的显式 participant 字段。 */
  explicitAgent?: string | null
  /** 显式 participant 在根上解析成功（且带角色）时的规范名；否则 null。 */
  explicitRootAgent?: string | null
  hostInternal: boolean
  /** null = 宿主拿不到 durable 权威快照；{ active: null } = 有快照、无活跃运行。 */
  authority?: { active?: { kind: RootKind; selectedAgent: string } | null } | null
  acceptedContinuation?: string | null
  landedOrigin?: Origin | null
  pendingClaim?: { sessionId: string; origin: Origin; selectedAgent: string } | null
  acceptedEvidence?: { sessionId: string; physicalId: string; origin: Origin; selectedAgent: string } | null
}

export type AdmissionRejection =
  | 'missing-session' | 'missing-physical'
  | 'invalid-explicit-agent' | 'accepted-participant-conflict' | 'prompt-key-not-claimed'
  | 'agent-owner-root-prompt-not-claimed' | 'claim-session-mismatch' | 'claim-origin-not-admissible'
  | 'unknown-origin-while-active'

export type Admission =
  | { kind: 'unmanaged' }
  | { kind: 'already-accepted'; origin: Origin }
  | { kind: 'host-internal' }
  | { kind: 'accepted-root-replay' }
  | { kind: 'external-root' }
  | { kind: 'active-human-continuation' }
  | { kind: 'pending-prompt' }
  | { kind: 'reject'; reason: AdmissionRejection }


/** interaction-authority-018 的五类预期关闭（闭集合，CUT-09-b）。 */
export type ClosureKind =
  | 'HumanRootManagerLife' | 'HumanRootManagedRun'
  | 'AgentOwnerChildWork' | 'AgentOwnerAttachedWork' | 'AgentOwnerInternalLeaf'

/** AgentOwnerRoot 的生命周期归属；InternalLeaf 不论物理 Ownership。 */
export type AgentOwnerLife = 'child' | 'attached' | 'internal-leaf'

/** 各类唯一合法的 source witness。 */
export type ClosureWitness =
  | { kind: 'LifeCompleted'; lifeId: string; factId: string }
  | { kind: 'ManagedLogicalRunTerminal'; logicalRunId: string; factId: string }
  | { kind: 'ChildLogicalRunTerminal'; ownerLogicalRunId: string; childLogicalRunId: string; factId: string }
  | { kind: 'AttachedLogicalRunTerminal'; ownerLogicalRunId: string; childLogicalRunId: string; attachmentKind: string; associationGeneration: string; factId: string }
  | { kind: 'InternalLeafTerminal'; ownerLogicalRunId: string; leafLogicalRunId: string; decisionOrTransactionId: string; factId: string }

/** 被关闭的已接受根。ownerLogicalRunId 只对 AgentOwnerRoot 有意义；lifeId 只对 HumanRootManagerLife。 */
export interface ClosingRoot {
  kind: ClosureKind
  sessionId: string
  logicalRunId: string
  rootId: string
  ownerLogicalRunId?: string | null
  lifeId?: string | null
}

export type ClosureRefusal =
  | 'root-kind-mismatch' | 'malformed-witness' | 'witness-kind-mismatch'
  | 'witness-identity-mismatch' | 'closing-identity-missing'

export type ClosureAdmission =
  | { ok: true; witness: ClosureWitness; legacy: boolean }
  | { ok: false; reason: ClosureRefusal }

export declare class Authority {
  register(active: RunRoot | null, requested: RunRoot): Registration
  close(active: RunRoot | null, last: RunRoot | null, logicalRunId: string, rootId: string): Closure
  closeChildWork(active: RunRoot | null, activeIsManager: boolean, last: RunRoot | null, logicalRunId: string, rootId: string): Closure
  resolveOrigin(input: OriginInput): Origin
  /** 入口准入的固定次序裁决；HumanRoot 只在无活跃运行且有根上解析成功的显式 participant 时授予。 */
  admit(input: AdmissionInput): Admission
  /** 根的唯一预期关闭类别；无法唯一归类（AgentOwnerRoot 缺归属、HumanRoot 带归属）时 null。 */
  expectedClosureKind(rootKind: RootKind, isManager: boolean, agentOwnerLife: AgentOwnerLife | null): ClosureKind | null
  /** AuthorityLogicalRunClosed.ClosureWitness 的唯一规范拼法（JSON 字符串数组，标签在前）。 */
  encodeClosureWitness(witness: ClosureWitness): string
  decodeClosureWitness(text: string): ClosureWitness | null
  /**
   * 关闭是否精确命中被关闭的根。旧格式裸 id 只在 HumanRootManagerLife 下读作
   * LifeCompleted(lifeId, id)，legacy=true。
   */
  admitClosure(closing: ClosingRoot, recordedRootKind: RootKind, witnessText: string): ClosureAdmission
}
