/**
 * wanxiangli/casebook — Casebook 公开索引的纯投影（CUT-27 子范围①，knowledge-reuse-008/012），
 * 以及 Bookkeeper 暂存事务的进程内自治对象（knowledge-reuse-006）。
 *
 * 索引律是纯计算：不读存储、不持有快照、不读时钟、不写事件。进程级冻结快照、“已失效”标记、
 * epoch 的数值与 Case 本体都归调用方；这里只给出名字、次序与是否推进的判定。
 * 暂存对象持有进程内事务槽状态：所有操作同步完成，不在状态变换中等待外部操作，
 * 不承诺跨线程或跨进程共享；宿主全部消费者经由唯一实例 bookkeeperStaging。
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

/** Fable 5 Result 的实际产物形状：tag 0 成功、tag 1 失败，fields 为 case 字段。 */
export type FableResult<T> =
  | { readonly tag: 0; readonly fields: [T] }
  | { readonly tag: 1; readonly fields: [string] }

/** 一笔 Bookkeeper 事务的进程内暂存 Case；语义迁移自主仓原 BookkeeperStaging 模块。 */
export declare class BookkeeperStaging {
  /** 开始暂存事务；同一 txId 重开直接覆盖，touched 归 false。 */
  beginTransaction(txId: string, question: string, answer: string): void
  /** 读取事务的 question/answer，不删除；缺失事务返回逐字错误。 */
  snapshot(txId: string): FableResult<[string, string]>
  /** 应用可选补丁；null/undefined 保留旧值。进入有效槽位即记为 touched。 */
  apply(txId: string, question?: string | null, answer?: string | null): FableResult<void>
  /** 取出并删除事务；本次 completion 未写入过则拒绝且不删除。 */
  take(txId: string): FableResult<[string, string]>
  /** 本次 completion 是否真正写入过；缺失事务为 false。 */
  touched(txId: string): boolean
  /** 不返回内容地移除事务；缺失也成功，幂等。 */
  abort(txId: string): void
}

/** 进程内唯一暂存注册表；ES 模块缓存保证全进程同一实例。 */
export declare const bookkeeperStaging: BookkeeperStaging
