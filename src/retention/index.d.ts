/**
 * wanxiangli/retention — 多 writer 历史的整条 writer 保留规则（CUT-19）。
 *
 * 纯计算：不读文件、不读时钟、不删除任何东西。截止时刻与活动时刻由调用方给出，
 * 物理删除与活动时刻的取得（Journal 尾部 ObservedAt 或文件时间）归调用方。
 */
export interface RetainedWriter {
  /** writer 最近活动时刻（毫秒，有限数）。 */
  readonly lastActivityMs: number
}

/** 一条尾行能说明的活动。 */
export type TailClassification =
  | { kind: 'observed'; observedAtMs: number }
  | { kind: 'cutTail' }
  | { kind: 'silent' }

export declare class WriterRetention {
  /** 一个 UTC 日的毫秒数。 */
  readonly dayMilliseconds: number
  /** UTC 日序号；非有限输入抛错。 */
  utcDay(timeMs: number): number
  /** 最近活动的 UTC 日不早于“今天的前一天”即保留；非有限输入抛错，不当作过期。 */
  isRetained(nowMs: number, lastActivityMs: number): boolean
  /** 同一截止时刻筛出保留 writer；保持顺序，返回调用方对象本身。 */
  retain<W extends RetainedWriter>(nowMs: number, writers: readonly W[]): W[]
  /**
   * 一条尾行的分类：`JournalEnvelope` 且 `payload.ObservedAt` 是可解析为有限时刻的字符串 → observed；
   * `ProjectionCutTail` → cutTail（前一条事实的整合元数据，不推进活动）；其余一律 silent。
   */
  classifyTail(line: string): TailClassification
  /**
   * writer 的持久活动时刻：按“最新在前”逐行拉取，第一条 observed 即答案；cutTail 继续往前；
   * silent 或行已读尽返回 null（调用方退回文件时间）。跨段时由调用方把上一段的行接在后面。
   * 只拉取需要的行，调用方可惰性读盘；提前停止时不调用迭代器的 return，资源由调用方自行释放。
   */
  lastActivity(linesNewestFirst: Iterable<string>): number | null
}
