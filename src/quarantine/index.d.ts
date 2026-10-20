/**
 * wanxiangli/quarantine — Integrator 业务规则隔离与截尾载荷律（vibe-fs CUT-19-b，durable-events 013/019/021）。
 *
 * 纯计算：不持有 Current、不读写事件、不做全量重放。规则本体（业务折叠、PlanCut/ApplyCut）、
 * 进程级唯一一次全量重放预算与乐观提交都归调用方。
 */
declare const ledgerBrand: unique symbol
/** 不透明、持久不可变的隔离账；只能由 RuleQuarantine 产生。 */
export type Ledger = { readonly [ledgerBrand]: true }

export interface Fault { readonly failedEventId: string; readonly reason: string }

export interface Cut { readonly rule: string; readonly failedEventId: string; readonly reason: string; readonly resetJson: string }

/** 线上载荷形状（键序固定）。 */
export interface CutPayload { readonly rule: string; readonly failed_event_id: string; readonly reason: string; readonly reset_json: string }

export declare class RuleQuarantine {
  readonly cutTailType: 'ProjectionCutTail'
  empty(): Ledger
  isQuarantined(ledger: Ledger, rule: string, scope: string): boolean
  fault(ledger: Ledger, rule: string, scope: string): Fault | null
  /** 登记失败（同键覆盖），返回新账。 */
  quarantine(ledger: Ledger, rule: string, scope: string, failedEventId: string, reason: string): Ledger
  /** 解除（不存在为空操作），返回新账。 */
  release(ledger: Ledger, rule: string, scope: string): Ledger
  size(ledger: Ledger): number
  encodeCut(cut: Cut): CutPayload
  /** 类型恰为 ProjectionCutTail 且四字段都是字符串才是截尾，否则 null。 */
  decodeCut(eventType: string, payload: unknown): Cut | null
  /** 规则在程序中且失败事件已整合（给出其 scope）时截尾才生效。 */
  cutVerdict(ruleKnown: boolean, failedEventScope: string | null): boolean
}
