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

export declare class WriterRetention {
  /** 一个 UTC 日的毫秒数。 */
  readonly dayMilliseconds: number
  /** UTC 日序号；非有限输入抛错。 */
  utcDay(timeMs: number): number
  /** 最近活动的 UTC 日不早于“今天的前一天”即保留；非有限输入抛错，不当作过期。 */
  isRetained(nowMs: number, lastActivityMs: number): boolean
  /** 同一截止时刻筛出保留 writer；保持顺序，返回调用方对象本身。 */
  retain<W extends RetainedWriter>(nowMs: number, writers: readonly W[]): W[]
}
