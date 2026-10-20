/**
 * wanxiangli/borrowing — 容量账本、执行托管与 provider-step 借用 owner（CUT-10）。
 *
 * 一枚 token = scheduler `running` 里的一次真实占位；借用只改变谁可以用 token，从不改变真实 token 的数量。
 * 选 target 的策略（route / tryOrdinary）与 target 的 provider、相等判定都由调用方给出；
 * 本对象不调用模型、不签发许可、不排执行准入队列、不计数。
 */

export interface BorrowingOptions<T> {
  /** target 的 provider 名（非空）。 */
  providerOf(target: T): string
  /** 两个 target 是否相同。 */
  sameTarget(left: T, right: T): boolean
}

/** 给定当前 `running`（每枚 token 的 target），选一个 target，或 null 表示不可用。 */
export type RoutePolicy<T> = (running: readonly T[]) => T | null | undefined

export interface ExecutionOwner {
  readonly sessionId: string
  /** 预留（尚无物理消息）时为空串。 */
  readonly physicalUserMessageId: string
}

export interface BorrowingSnapshot<T> {
  readonly ledgerEntries: readonly { readonly credit: number; readonly target: T }[]
  readonly tokens: readonly {
    readonly credit: number
    readonly state: 'Idle' | 'InFlight' | 'Retiring'
    readonly owner: ExecutionOwner
    readonly target: T
  }[]
  readonly custodies: readonly { readonly credit: number; readonly owner: ExecutionOwner }[]
  readonly waiters: readonly { readonly owner: ExecutionOwner; readonly sequence: number; readonly kind: 'ProviderStep' }[]
  readonly idleCount: number
  readonly inFlightCount: number
  readonly retiringCount: number
}

export declare class CapacityBorrowing<T = unknown> {
  constructor(options: BorrowingOptions<T>)
  /** 为新物理执行选 target 并托管容量；不可用时 null，且除非 retireOnUnavailable === false 退休旧执行的托管。 */
  routeFresh(
    sessionId: string,
    oldPhysicalUserMessageId: string | null,
    newPhysicalUserMessageId: string,
    lenderSessionId: string | null,
    route: RoutePolicy<T>,
    retireOnUnavailable?: boolean,
  ): T | null
  /** 尚无物理消息时预留。 */
  reserveFresh(sessionId: string, lenderSessionId: string | null, route: RoutePolicy<T>): T | null
  adoptReservation(sessionId: string, physicalUserMessageId: string, target: T): void
  /** 续接方已有托管或前者没有托管时抛出。 */
  continueExecution(sessionId: string, previousPhysicalId: string, physicalId: string, target: T): T
  releaseSession(sessionId: string): 'Applied' | 'AlreadyApplied'
  releasePhysical(sessionId: string, physicalUserMessageId: string): 'Applied' | 'AlreadyApplied'
  /** provider step 准入；被授予时 resolve，被释放取消时以 OperationCanceledException reject，队满时以 Error reject。 */
  enterStep(
    sessionId: string,
    physicalUserMessageId: string,
    target: T,
    fence: readonly string[],
    tryOrdinary: (running: readonly T[]) => boolean,
    requestKey?: string | null,
  ): Promise<void>
  endStep(sessionId: string, physicalUserMessageId: string, providerRun: string): void
  suppressStep(sessionId: string, physicalUserMessageId: string): void
  /** 精确托管的 credit（拥有的或借来的）；没有时抛出。 */
  exactCredit(sessionId: string, physicalUserMessageId: string): number
  invariantSnapshot(): BorrowingSnapshot<T>
  /** scheduler `running`。 */
  snapshot(): readonly T[]
  fail(error: unknown): void
}
