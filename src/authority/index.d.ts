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

export declare class Authority {
  register(active: RunRoot | null, requested: RunRoot): Registration
  close(active: RunRoot | null, last: RunRoot | null, logicalRunId: string, rootId: string): Closure
  closeChildWork(active: RunRoot | null, activeIsManager: boolean, last: RunRoot | null, logicalRunId: string, rootId: string): Closure
  resolveOrigin(input: OriginInput): Origin
}
