/**
 * wanxiangli/routing — 模型调度器协议 owner（CUT-10）。
 *
 * 只管 ABI：MJS 模块的导出形状与协议版本、同步调用 route(role, running, previous)、
 * target 的严格解码、理论容量查询的结果类型。不读文件、不 import 模块、不持有容量账本；
 * 模型选择与并发上限全部属于用户 MJS（execution-model-routing [005]）。
 * 所有错误都是 `Error`，消息以 `execution-model-routing:` 开头，调用方按配置错误 fail closed。
 */

/** 调度目标：`model` 是修剪后的完整 `provider/model`，`reasoning` 是修剪后的非空字符串。 */
export interface ModelTarget {
  readonly model: string
  readonly reasoning: string
}

/** 已校验的调度策略（冻结）。 */
export interface SchedulerPolicy {
  readonly route: (role: string, running: readonly ModelTarget[], previous: ModelTarget | null) => unknown
  readonly hasTheoreticalCapacity: (role: string) => unknown
  /** 未导出时为 null。 */
  readonly markProviderFailed: ((provider: string) => unknown) | null
}

export declare class RoutingProtocol {
  /** 协议版本：2。 */
  readonly version: 2
  /**
   * 校验 MJS 模块命名空间：default 是函数，`routingProtocol === 2`（数字），
   * `hasTheoreticalCapacity` 是函数；`markProviderFailed` 可省略，出现时必须是函数。
   */
  admit(moduleNamespace: unknown): SchedulerPolicy
  /**
   * 以恰好三个参数调用 route。role 修剪且非空；running 与 previous 逐项严格解码并以冻结副本交出。
   * 返回 Promise、抛错或非法 target 一律抛错；null / undefined 表示“等待”，交还 null。
   */
  route(route: unknown, role: string, running: readonly ModelTarget[], previous: ModelTarget | null): ModelTarget | null
  /** 以恰好一个参数调用理论容量查询；结果必须是布尔，Promise 或其它值抛错。 */
  hasTheoreticalCapacity(query: unknown, role: string): boolean
  /** 严格解码 target，交还修剪后的冻结副本；null、空字段、非 provider/model 抛错。 */
  decodeTarget(value: unknown): ModelTarget
  /** 解码持久道路的 `provider/model:reasoning`（最后一个 ':' 分隔：模型名可以含 ':'）；规则同 decodeTarget。 */
  decodeDurableTarget(value: string): ModelTarget
  /** target 的 provider（model 中第一个 '/' 之前）；target 先严格解码。 */
  providerOf(target: ModelTarget): string
}

import type { ExecutionPermit, ExecutionIdentity, PermitResult, PermitOutcome, PermitState, TransitionCountersSnapshot } from 'wanxiangli/permit'

export type ExecutionRoutingLease = ExecutionPermit
export interface ExecutionRoutingRequest {
  readonly sessionId: string
  readonly physicalUserMessageId: string
  readonly role: string
  readonly participant: string
  readonly purpose?: 'normal'
  readonly lenderSessionId?: string | null
  readonly hostTarget?: ModelTarget | null
}
export interface ExecutionRoutingNode {
  readonly nodeId: number
  readonly fence: number
  readonly sequence: number
  readonly sessionId: string
  readonly physicalUserMessageId: string
  readonly completion: Promise<ExecutionRoutingAcquisition>
}
export type ExecutionRoutingAcquisition =
  | { readonly kind: 'Admitted'; readonly lease: ExecutionRoutingLease }
  | { readonly kind: 'Queued'; readonly node: ExecutionRoutingNode }
  | { readonly kind: 'QueueFull' | 'Cancelled' | 'Superseded' }
export type ExecutionRoutingPolicy = SchedulerPolicy['route'] & {
  readonly hasTheoreticalCapacity?: SchedulerPolicy['hasTheoreticalCapacity'] | null
}
export interface ExecutionRoutingOptions {
  readonly scheduler: ExecutionRoutingPolicy | null
  readonly binding?: {
    applies(role: string): boolean
    read(sessionId: string): string | null | undefined
    error(detail: { readonly kind: 'immutable' | 'durable'; readonly bound: ModelTarget; readonly target: ModelTarget }): Error
  } | null
}
export interface ExecutionRoutingOwner {
  readonly sessionId: string
  readonly physicalUserMessageId: string
  readonly role: string | null
  readonly participant: string | null
}
export interface ExecutionRoutingSnapshot {
  readonly ledgerEntries: readonly { readonly credit: number; readonly target: ModelTarget }[]
  readonly tokens: readonly {
    readonly credit: number
    readonly state: 'Idle' | 'InFlight' | 'Retiring'
    readonly owner: ExecutionRoutingOwner
    readonly target: ModelTarget
  }[]
  readonly custodies: readonly { readonly credit: number; readonly owner: ExecutionRoutingOwner }[]
  readonly executions: readonly ExecutionRoutingOwner[]
  readonly waiters: readonly { readonly owner: ExecutionRoutingOwner; readonly sequence: number; readonly kind: 'ProviderStep' | 'Admission' }[]
  readonly owners: readonly ExecutionRoutingOwner[]
  readonly lineage: readonly { readonly parentSessionId: string; readonly childSessionId: string }[]
  readonly idleCount: number
  readonly inFlightCount: number
  readonly retiringCount: number
  readonly activeCount: number
  readonly counters: TransitionCountersSnapshot
}
export type PhysicalRoutingRelease =
  | { readonly kind: 'HeldForInput' }
  | { readonly kind: 'Released'; readonly outcome: PermitOutcome }

/** 容量与许可各自持有事实；本对象只持有执行、等待、续接及 provider step 的合作状态。 */
export declare class ExecutionRouting {
  constructor(options: ExecutionRoutingOptions)
  acquire(request: ExecutionRoutingRequest): Promise<ExecutionRoutingAcquisition>
  reserve(request: Pick<ExecutionRoutingRequest, 'sessionId' | 'role' | 'purpose' | 'lenderSessionId'>): ModelTarget | null
  tryLease(request: ExecutionRoutingRequest): ModelTarget | null
  target(lease: ExecutionRoutingLease): PermitResult<ModelTarget>
  lifecycle(lease: ExecutionRoutingLease): PermitResult<PermitState>
  commit(lease: ExecutionRoutingLease, observed: ExecutionIdentity): PermitOutcome
  releaseBeforeProvider(lease: ExecutionRoutingLease, observed: ExecutionIdentity): PermitOutcome
  tryRead(sessionId: string, physicalUserMessageId: string): ExecutionRoutingLease | null
  retainInput(lease: ExecutionRoutingLease, physicalUserMessageId: string): ModelTarget
  tryInput(sessionId: string, physicalUserMessageId: string): ExecutionRoutingLease | null
  cancelInput(sessionId: string, physicalUserMessageId: string): void
  cancelSessionInputs(sessionId: string): void
  continue(lease: ExecutionRoutingLease, physicalUserMessageId: string, selectedTarget?: ModelTarget | null): Promise<ExecutionRoutingAcquisition>
  wasSuperseded(sessionId: string, physicalUserMessageId: string): boolean
  wasStoppedSuperseded(sessionId: string, physicalUserMessageId: string): boolean
  owns(sessionId: string, physicalUserMessageId: string): boolean
  rememberStep(sessionId: string, physicalUserMessageId: string, providerRun: string): void
  stepOf(providerRun: string): { readonly sessionId: string; readonly physicalUserMessageId: string } | null
  activePhysical(sessionId: string): string | null
  /** 仅移除固定目标缓存，不释放会话。 */
  dropSession(sessionId: string): void
  setBoundReader(read: (sessionId: string) => string | null | undefined): void
  seedBoundTarget(sessionId: string, value: string): void
  boundTarget(sessionId: string): ModelTarget | null
  releaseSession(sessionId: string): PermitOutcome
  releasePhysical(sessionId: string, physicalUserMessageId: string): PhysicalRoutingRelease
  cancelPending(sessionId: string): PermitOutcome
  cancelPendingPhysical(sessionId: string, physicalUserMessageId: string): PermitOutcome
  snapshot(): ExecutionRoutingSnapshot
  holdsPhysical(sessionId: string, physicalUserMessageId: string): boolean
  enterStep(request: { readonly sessionId: string; readonly physicalUserMessageId: string; readonly visibleProviderRuns: readonly string[]; readonly requestKey?: string | null }): Promise<void>
  endStep(sessionId: string, physicalUserMessageId: string, providerRun: string): void
  suppressStep(sessionId: string, physicalUserMessageId: string): void
  occupied(): readonly ModelTarget[]
  readonly pendingCount: number
  readonly pendingBound: 32
  readonly pendingContractVersion: 1
  takeRunTarget(providerRun: string): ModelTarget | null
  hasTheoreticalCapacity(role: string, purpose?: 'normal'): boolean
}
