export interface OwnerRef {
  readonly kind: string
  readonly identity: Readonly<Record<string, string>>
}

export type ProducerRef =
  | { readonly kind: 'workflow'; readonly owner: OwnerRef }
  | { readonly kind: 'external'; readonly producerKind: string; readonly identity: Readonly<Record<string, string>> }

export interface WaitDescriptor {
  readonly waitKind: string
  readonly owner: OwnerRef
  readonly subject: Readonly<Record<string, string>>
  readonly producer: ProducerRef
  readonly escapes: ReadonlyArray<
    | { readonly kind: 'deadlineAt'; readonly at: string }
    | { readonly kind: 'cancelledBy'; readonly owner: OwnerRef }
    | { readonly kind: 'processLifetime' | 'sessionLifetime' | 'openEndedExternal' }
  >
  readonly source: string
}

export type WaitExitName = 'WaitResolved' | 'WaitFailed' | 'WaitCancelled' | 'WaitTimedOut' | 'WaitDisposed'

export interface WaitSnapshot {
  readonly active: readonly WaitDescriptor[]
  readonly history: ReadonlyArray<{
    readonly sequence: number
    readonly kind: 'Entered' | 'Left'
    readonly wait: WaitDescriptor
    readonly exit: WaitExitName | null
  }>
  readonly sequence: number
}

export type FrontierKind =
  | 'ExternalProducerFrontier'
  | 'BrokenCausalEdge'
  | 'ProducerRunningWithoutWait'
  | 'CausalWaitCycle'
  | 'Empty'

export interface Frontier {
  readonly kind: FrontierKind
  readonly detail: string
  readonly chain: ReadonlyArray<{ readonly owner: OwnerRef; readonly waitKind: string | null }>
  readonly cycle: readonly OwnerRef[]
  readonly producer: ProducerRef | null
}

export interface IDeadlineHandle {
  readonly Delay: Promise<void>
  Cancel(): void
}

/** 不透明租约：markExit 记录诊断退出原因；dispose 清除活跃等待。两者幂等。 */
export interface WaitLease {
  markExit(exit: WaitExitName): void
  dispose(): void
}

export interface CompletionMailbox {
  pulseAgent(agent: unknown): void
  publishPty(pty: unknown): void
  pulseWake(): void
  waitForWake(): Promise<'CompletionMayBeAvailable' | 'MailboxCancelled' | { LocalInterrupt: unknown }>
  drainAgents(maxCount: number): unknown[]
  drainPtys(maxCount: number): unknown[]
  cancel(): boolean
  pendingCount(): number
  pendingPtyCount(): number
  isCancelled(): boolean
}

export interface JoinInterruptSource {
  readonly wait: Promise<'OperatorAbort' | 'UserMessageArrived' | 'DeadlineExpired'>
  signal(reason: 'OperatorAbort' | 'UserMessageArrived' | 'DeadlineExpired'): void
}

export const Wait: {
  /** 创建进程内等待注册表；historyCapacity 传 null 用默认 256。 */
  createRegistry(historyCapacity: number | null): unknown
  /** 描述符构造辅助。 */
  owner(kind: string, identity: Record<string, string>): OwnerRef
  externalProducer(kind: string, identity: Record<string, string>): ProducerRef
  workflowProducer(owner: OwnerRef): ProducerRef
  escape(kind: 'deadlineAt', at: string): { kind: 'deadlineAt'; at: string }
  escape(kind: 'cancelledBy', owner: OwnerRef): { kind: 'cancelledBy'; owner: OwnerRef }
  escape(kind: 'processLifetime' | 'sessionLifetime' | 'openEndedExternal' | string, value?: unknown): { kind: string }
  observerCapability(registry: unknown): unknown
  snapshotReaderCapability(registry: unknown): unknown
  observerEnter(observer: unknown, descriptor: WaitDescriptor): WaitLease
  readerSnapshot(reader: unknown): WaitSnapshot
  enter(registry: unknown, descriptor: WaitDescriptor): WaitLease
  markExit(lease: unknown, exit: WaitExitName): void
  dispose(lease: unknown): void
  snapshot(registry: unknown): WaitSnapshot
  historyCapacity(registry: unknown): number
  /** 绑定诊断 sink（{ Publish(snapshot) }）；首绑唯一，返回是否绑定成功。 */
  bindDiagnosticTarget(registry: unknown, sink: { Publish(snapshot: unknown): void }): boolean
  ownerKey(owner: OwnerRef): string
  producerKey(producer: ProducerRef): string
  frontiers(active: readonly WaitDescriptor[]): Frontier[]
  frontiersOfSnapshot(snapshot: { active: readonly WaitDescriptor[] }): Frontier[]
  awaitTask(registry: unknown, descriptor: WaitDescriptor, pending: Promise<unknown>): Promise<unknown>
  /** 信号与截止时间竞争的复合等待；返回 { ok: true, value } 或 { ok: false, reason }。 */
  untilSignalOrDeadline(
    registry: unknown,
    descriptor: WaitDescriptor,
    deadline: IDeadlineHandle,
    tryRead: () => unknown,
    awaitSignal: () => Promise<void>,
  ): Promise<{ ok: true; value: unknown } | { ok: false; reason: WaitExitName }>
  completionMailbox(): CompletionMailbox
  interrupt(): JoinInterruptSource
  readonly maxJoinBatch: number
}
