/**
 * wanxiangli/casebook — Casebook 公开索引的纯投影（CUT-27 子范围①，knowledge-reuse-008/012）。
 *
 * 纯计算：不读存储、不持有快照、不读时钟、不写事件。进程级冻结快照、“已失效”标记、
 * epoch 的数值与 Case 本体都归调用方；这里只给出名字、次序与是否推进的判定。
 */
export interface IndexCase {
  readonly sessionId: string
  readonly question: string
}

/** 模型可见的唯一条目形状：不含会话身份。 */
export interface IndexEntry {
  readonly shelfmark: string
  readonly question: string
}

export interface AccessCase {
  readonly sessionId: string
  /** 访问序；主仓 int64 以 bigint 到达，也接受有限 number。 */
  readonly accessOrder: number | bigint
}

export declare class CasebookIndexLaw {
  /** 第一条非空行去掉行首 Markdown 记号、折叠空白；超过 72 个码元截为 71 加 “…”，绝不拆开代理对。 */
  compactTitle(question: string): string
  /** `<标题> · <8 位十六进制判别后缀>`；同输入恒同输出，良构字符串，不含 sessionId。 */
  shelfmarkFor(sessionId: string, question: string): string
  /** 公开条目，按 shelfmark 码元序稳定排序（同名保留输入次序）。 */
  entries(cases: readonly IndexCase[]): IndexEntry[]
  /** shelfmark 寻址的 case 在输入中的下标（与 entries 同序的第一个同名者），找不到为 -1。 */
  locate(cases: readonly IndexCase[], shelfmark: string): number
  /** 刷新是否推进 epoch：无上一快照、已失效，或公开条目逐项（含次序）有变。 */
  advancesEpoch(previous: readonly IndexEntry[] | null, dirty: boolean, entries: readonly IndexEntry[]): boolean
  /** LRU：容量 ≤ 0 或未超容量为空；否则按访问序升序（同序保留输入次序）给出最旧的 count - capacity 个 sessionId。 */
  evictionVictims(capacity: number, cases: readonly AccessCase[]): string[]
}
