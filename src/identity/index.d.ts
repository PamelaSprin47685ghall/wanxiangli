/**
 * wanxiangli/identity — 参与者身份与物理执行绑定的分离合同。
 *
 * 身份（ParticipantIdentity）是 logical run 内不可变的规范证据；
 * 执行绑定（ExecutionBinding）持有会话/消息物理落点、执行角色、模型目标
 * 与容量围栏。换模型、换租约不改变身份；身份变更也不得伪装成重绑。
 * 来源鉴别（classifyOrigin）fail-closed：未知来源一律拒绝，绝不回退 human。
 */

export type RoleLabel =
  | 'manager' | 'orchestrator' | 'engineer' | 'coder' | 'inspector'
  | 'browser' | 'inquiry' | 'devops' | 'distiller' | 'plan' | 'advisor'

export type PersonaOriginLabel = 'ResolvedAtRoot' | 'InheritedFromOwner'

/** 稳定参与者身份的 plain 投影。Bookkeeper 身份的 role 为 null。 */
export interface IdentityEvidence {
  name: string
  role: RoleLabel | null
  persona: string
  catalogVersion: number
  origin: PersonaOriginLabel
}

export interface IdentitySuccess { ok: true; evidence: IdentityEvidence }
/**
 * 失败投影。名/版本/标签类错误带 detail；错配类错误
 * （RoleMismatch、PersonaMismatch、OriginMismatch、OwnerPersonaMismatch、
 * OwnerCatalogVersionMismatch）带 expected 与 actual（RoleMismatch 中 null 表示 Bookkeeper）。
 */
export interface IdentityFailure {
  error: string
  detail?: string | number
  expected?: string | number | null
  actual?: string | number | null
}
export type IdentityResult = IdentitySuccess | IdentityFailure

export interface VerifiedOrigin {
  kind: 'human-root' | 'agent-owner-root' | 'host-internal' | 'continuation'
  participant?: string
  ownerLogicalRun?: string
  childLogicalRun?: string
  childParticipant?: string
  continuationKind?: string
}

export interface OriginSuccess { ok: true; origin: VerifiedOrigin }
export interface OriginFailure { error: 'UnknownPromptOrigin'; reason: string }
export type OriginResult = OriginSuccess | OriginFailure

export interface BindingView {
  sessionId: string
  physicalUserMessageId: string
  role: RoleLabel
  evidence: IdentityEvidence
  modelTarget: string
  capacityFence: string
}

export interface BindSuccess { ok: true; binding: BindingView }
export type BindResult = BindSuccess | IdentityFailure

export interface BindInput {
  sessionId: string
  physicalUserMessageId: string
  role: RoleLabel
  evidence: IdentityEvidence
  modelTarget: string
  capacityFence: string
}

export interface RebindTarget { modelTarget: string; capacityFence: string }

export declare class Identity {
  /** 活跃角色（目录顺序）：orchestrator, manager, engineer, devops, plan, advisor。 */
  activeRoleLabels(): RoleLabel[]
  /** 已退役、只供历史解码的角色。 */
  historicalRoleLabels(): RoleLabel[]
  /** Advisor 与 Distiller 是内部角色，不进入公开 fork / horizon 词汇。 */
  isInternalRole(label: unknown): boolean
  legacyNames(): string[]
  isLegacyName(name: unknown): boolean
  tryParseRole(label: unknown): RoleLabel | null
  tryParseHistoricalRole(label: unknown): RoleLabel | null
  personaOfRole(label: unknown): string | null
  bookkeeperPersona(): string
  tryParsePersona(label: unknown): string | null
  resolveAtRoot(name: unknown): IdentityResult
  /** owner 是本库先前产出的证据视图，经 restoreRecorded 校验后采信。 */
  inheritFromOwner(name: unknown, owner: IdentityEvidence): IdentityResult
  rehydrate(owner: IdentityEvidence | null, input: IdentityEvidence): IdentityResult
  /** 恢复已随原子事实记录的证据；继承证据不再要求 owner 见证。 */
  restoreRecorded(input: IdentityEvidence): IdentityResult
  classifyOrigin(raw: unknown): OriginResult
  bindExecution(input: BindInput): BindResult
  rebindTarget(binding: BindingView, target: RebindTarget | string): BindResult
}
