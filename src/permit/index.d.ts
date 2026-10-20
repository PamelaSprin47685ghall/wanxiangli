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

/** 本实例签发的冻结许可。只有签发它的实例认得它；同形的伪造对象不是许可。 */
export interface ExecutionPermit {
  readonly leaseId: number
  readonly fence: number
  readonly credit: number
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
  issue(identity: ExecutionIdentity, credit: number): ExecutionPermit
  /** 许可的 target；未知、伪造、被替代或 fence 不符的许可给出拒绝。 */
  target(permit: ExecutionPermit, fence: number): PermitResult<ModelTarget>
  /** 观察到的精确身份与许可一致时 Pending → Committed；重复提交幂等；释放后提交冲突。 */
  commit(permit: ExecutionPermit, fence: number, observed: ExecutionIdentity): PermitOutcome
  /** 提供方开始前释放：Pending → Released(BeforeProvider)。已提交的许可不能走这条路（Conflict）。 */
  releaseBeforeProvider(permit: ExecutionPermit, fence: number, observed: ExecutionIdentity): PermitOutcome
  /** 物理执行完成：只释放该会话当前许可且物理消息一致者；另一种释放之后为 Conflict。 */
  releasePhysical(sessionId: string, physicalUserMessageId: string): PermitOutcome
  /** 许可当前状态。 */
  lifecycle(permit: ExecutionPermit, fence: number): PermitResult<PermitState>
  /** 只读：该会话当前许可已提交且物理消息一致时交还它，否则 null。 */
  committed(sessionId: string, physicalUserMessageId: string): ExecutionPermit | null
}
