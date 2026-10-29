/**
 * wanxiangli/permit — 精确执行容量许可 owner（CUT-10）。
 *
 * 每个会话至多一张当前许可；许可绑定一次物理执行的精确身份（会话、物理用户消息、角色、参与者、target）
 * 与调用方容量账本中的一个 credit。只管签发、提交、两种互斥释放与只读查询：
 * 不选模型、不持有容量账本、不排队、不计数（调用方按返回的结果分类计数）。
 */

export interface ModelTarget {
  readonly model: string
  readonly reasoning: string
}

/** 一次物理执行的精确身份。所有字段按字符串原样比较。 */
export interface ExecutionIdentity {
  readonly sessionId: string
  readonly physicalUserMessageId: string
  readonly role: string
  readonly participant: string
  readonly target: ModelTarget
}

/** int64 正整数；number 只接受安全整数，超出安全范围用 bigint。 */
export type ExactInteger = number | bigint

/** 本实例签发的冻结许可。只有签发它的实例认得它；同形的伪造对象不是许可。 */
export interface ExecutionPermit {
  readonly leaseId: ExactInteger
  readonly fence: ExactInteger
  readonly credit: ExactInteger
  readonly identity: ExecutionIdentity
}

/** 迁移结果：成功、重复（幂等）、过期（未知/错 fence/已被替代）、冲突（身份不符或互斥终态）。 */
export type PermitOutcome = 'Applied' | 'AlreadyApplied' | 'StaleFence' | 'Conflict'

export type PermitRejection =
  | 'UnknownLease'
  | 'WrongFence'
  | 'StaleLease'
  | 'WrongSession'
  | 'WrongPhysicalUserMessage'
  | 'WrongRole'
  | 'WrongParticipant'
  | 'WrongTarget'
  | 'IllegalTransition'
  | 'OppositeTerminalConflict'

export type PermitResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly rejection: PermitRejection }

export type PermitState = 'Pending' | 'Committed' | 'Releasing' | 'Released'

export declare class ExecutionPermits {
  /**
   * 签发许可。同一会话、同一身份、同一 credit 的重复签发交还原许可（任何状态）；
   * 否则签发新许可（新 leaseId 与 fence）并替代该会话的旧许可。credit 必须是正整数。
   */
  issue(identity: ExecutionIdentity, credit: ExactInteger): ExecutionPermit
  /** 许可的 target；未知、伪造、被替代或 fence 不符的许可给出拒绝。 */
  target(permit: ExecutionPermit, fence: ExactInteger): PermitResult<ModelTarget>
  /** 观察到的精确身份与许可一致时 Pending → Committed；重复提交幂等；释放后提交冲突。 */
  commit(permit: ExecutionPermit, fence: ExactInteger, observed: ExecutionIdentity): PermitOutcome
  /** 提供方开始前释放：Pending → Released(BeforeProvider)。已提交的许可不能走这条路（Conflict）。 */
  releaseBeforeProvider(permit: ExecutionPermit, fence: ExactInteger, observed: ExecutionIdentity): PermitOutcome
  /** 物理执行完成：只释放该会话当前许可且物理消息一致者；另一种释放之后为 Conflict。 */
  releasePhysical(sessionId: string, physicalUserMessageId: string): PermitOutcome
  /** 许可当前状态。 */
  lifecycle(permit: ExecutionPermit, fence: ExactInteger): PermitResult<PermitState>
  /** 只读：该会话当前许可已提交且物理消息一致时交还它，否则 null。 */
  committed(sessionId: string, physicalUserMessageId: string): ExecutionPermit | null
}
/**
 * 迁移计数快照。
 */
export interface TransitionCountersSnapshot {
  readonly duplicate: number
  readonly stale: number
  readonly conflict: number
}

/**
 * 容量迁移结果计数器：以自治对象持有 duplicate、stale、conflict 可变状态。
 */
export declare class CapacityTransitionCounters {
  /**
   * 记录迁移结果。对 AlreadyApplied 递增 duplicate，StaleFence 递增 stale，Conflict 递增 conflict；Applied 不计数。原样返回 outcome。
   */
  record(outcome: PermitOutcome | string): string
  /** 直接递增 duplicate 并返回新计数。 */
  recordDuplicate(): number
  /** 直接递增 stale 并返回新计数。 */
  recordStale(): number
  /** 直接递增 conflict 并返回新计数。 */
  recordConflict(): number
  /** 获取当前计数快照。 */
  snapshot(): TransitionCountersSnapshot
  /** 重置所有计数为 0。 */
  reset(): void
}

/** 全局单例容量迁移计数器。 */
export declare const capacityTransitionCounters: CapacityTransitionCounters

/**
 * 会话租约句柄快照。
 */
export interface SessionLeaseHandlesSnapshot {
  readonly activeCount: number
  readonly nextLeaseId: ExactInteger
  readonly nextFence: ExactInteger
}

/**
 * 会话租约句柄缓存与单调序号管理器：
 * 独占管理 session 句柄映射并递增 nextLeaseId 与 nextFence，严格校验 fence 一致性。
 */
export declare class SessionLeaseHandles {
  /**
   * 获取或创建会话租约句柄。同会话同许可直接复用已有句柄；
   * 否则递增 nextLeaseId 与 nextFence、校验 permit.fence === nextFence（不一致抛出异常），调用 createHandle 缓存并返回。
   */
  handleFor<T>(sessionId: string, permit: ExecutionPermit, createHandle: (leaseId: ExactInteger, fence: ExactInteger) => T): T
  /** 仅当会话存在且许可与已缓存者相同时返回句柄，否则返回 null。 */
  tryGetMatching<T>(sessionId: string, permit: ExecutionPermit): T | null
  /** 只读查询会话当前句柄。 */
  current<T>(sessionId: string): T | null
  /** 查询会话是否存在句柄。 */
  has(sessionId: string): boolean
  /** 获取当前句柄池与序号快照。 */
  snapshot(): SessionLeaseHandlesSnapshot
  /** 清空会话句柄字典。 */
  clear(): void
  readonly nextLeaseId: ExactInteger
  readonly nextFence: ExactInteger
  getNextLeaseId(): ExactInteger
  getNextFence(): ExactInteger
}

/** 全局单例会话租约句柄管理器。 */
export declare const sessionLeaseHandles: SessionLeaseHandles
