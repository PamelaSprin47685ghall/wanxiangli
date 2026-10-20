/**
 * wanxiangli/capacity — 容量不变量对账律（CUT-10）。
 *
 * 给定调用方容量账本、令牌、托管、执行、等待者与计数器的一次一致快照，回答 NoOp 或 FailClosed。
 * 不读账本、不改状态、不修复、不关停；只读快照，按固定次序报告全部失败。
 */

/** 精确 owner。role / participant 可为 null（未知），按值比较；null 与空串不同。 */
export interface CapacityOwner {
  readonly sessionId: string
  readonly physicalUserMessageId: string
  readonly role: string | null
  readonly participant: string | null
}

export interface CapacityInvariantEvidence {
  readonly ledgerEntries: readonly { readonly credit: number }[]
  /** state 为 'Idle' | 'InFlight' | 'Retiring'；其它值不计入任何一类（因而触发 TokenStateCountMismatch）。 */
  readonly tokens: readonly { readonly credit: number; readonly state: string; readonly owner: CapacityOwner }[]
  readonly custodies: readonly { readonly credit: number; readonly owner: CapacityOwner }[]
  readonly executions: readonly CapacityOwner[]
  readonly waiters: readonly { readonly owner: CapacityOwner }[]
  readonly owners: readonly CapacityOwner[]
  readonly idleCount: number
  readonly inFlightCount: number
  readonly retiringCount: number
  readonly activeCount: number
  readonly counters: { readonly duplicate: number; readonly stale: number; readonly conflict: number }
}

export type CapacityReconciliationFailure =
  | 'ActiveOutsideLedgerBounds'
  | 'TokenStateCountMismatch'
  | 'MapLedgerDivergence'
  | 'UntraceableTokenOwner'
  | 'UntraceableWaiterOwner'
  | 'UntraceableExecutionCustody'
  | 'CounterRegression'

export type CapacityReconciliationDecision =
  | { readonly decision: 'NoOp' }
  | { readonly decision: 'FailClosed'; readonly failures: readonly CapacityReconciliationFailure[] }

export declare class CapacityReconciliation {
  /** 形状不合法（非数组、非整数计数、非字符串身份字段）直接抛错，不当作 NoOp。 */
  decide(evidence: CapacityInvariantEvidence): CapacityReconciliationDecision
}
