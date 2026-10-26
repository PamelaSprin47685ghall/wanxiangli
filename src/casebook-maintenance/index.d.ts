/**
 * wanxiangli/casebook-maintenance — Casebook 按差异维护的纯决策与结算状态所有者（CUT-27 / Package-09）。
 *
 * 纯计算：不读文件、不读写 payload、不调 Bookkeeper、不写事件。读取基线 B 与目标状态 T、
 * 冻结 payload、请求 CaseRefresh 与原子提交都归调用方；这里只给出 diff 文本、判定与结算状态所有权。
 */
export interface MaintenanceSummary {
  /** 逐文件 diff 按给出次序拼接。 */
  readonly diffSummary: string
  /** 有差异才请求 CaseRefresh；false 时返回旧正文并说明未检测到变化。 */
  readonly refresh: boolean
}

export interface TruncatedDiff {
  readonly text: string
  readonly isTruncated: boolean
  readonly notice: string
}

export declare class CasebookMaintenanceLaw {
  /** B→T 的零上下文统一 diff；null 为 Missing。B 与 T 相同时为空串；Missing↔Present 带 new file / deleted file。 */
  fileDiff(path: string, before: string | null, after: string | null): string
  summarize(diffs: readonly string[]): MaintenanceSummary
  /** 只有 `ENOENT` 是 Missing；其它读取错误都是故障，不得冒充不存在。 */
  readFailure(code: unknown): 'missing' | 'fault'
  /** 截到预算内：头尾各约一半加截断声明，不在代理对中间截断。 */
  truncate(diff: string, budget: number): TruncatedDiff
}

export type SettlementIncidentKind = "StorageInvalid" | "SemanticCut" | "Unscoped";
export type SettlementOutcomeTag =
  | "LogScopeFailure"
  | "CaseUnavailable"
  | "CaseUnavailableKnown"
  | "Unscoped";

export declare class CasebookSettlementOwner<TIncident = unknown> {
  constructor(onConflict: (incident: TIncident) => void);
  Observe(
    eventId: string,
    kind: SettlementIncidentKind,
    incident: TIncident | null | undefined
  ): SettlementOutcomeTag;
  Redeliver(eventId: string, incident: TIncident): "CaseUnavailableKnown";
  readonly SnapshotCount?: number;
}
