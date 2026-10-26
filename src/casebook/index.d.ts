/**
 * wanxiangli/casebook — Casebook 公开索引的纯投影（CUT-27 子范围①，knowledge-reuse-008/012），
 * Bookkeeper 暂存事务的进程内自治对象（knowledge-reuse-006），
 * 以及会话草稿注册表的进程内自治对象（knowledge-reuse-010）。
 *
 * 索引律是纯计算：不读存储、不持有快照、不读时钟、不写事件。进程级冻结快照、“已失效”标记、
 * epoch 的数值与 Case 本体都归调用方；这里只给出名字、次序与是否推进的判定。
 * 暂存对象持有进程内事务槽状态：所有操作同步完成，不在状态变换中等待外部操作，
 * 不承诺跨线程或跨进程共享；宿主全部消费者经由唯一实例 bookkeeperStaging。
 * 草稿对象持有进程内委托会话的问答轮次：支持未答覆写、已答追加、覆写 A 及原子消费（tryTake）。
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

export interface CasebookIndexSnapshot {
  readonly epoch: number | bigint
  readonly cases: readonly IndexEntry[]
}

/** 进程内 Casebook 公开索引自治状态机；语义迁移自主仓原 CasebookIndex 模块。 */
export declare class CasebookIndex {
  constructor()
  /** 读取当前冻结的公开快照，未完成首次冻结前返回 null。 */
  tryGet(): CasebookIndexSnapshot | null
  /** 标记公开索引已失效；促使下一次成功 freeze 推进 epoch。 */
  invalidate(): void
  /**
   * 给定内部案例集合计算公开条目并冻结为新快照。
   * 即使 cases 为空集合，首次成功冻结也产生 epoch = 0n, dirty = false；
   * 后续仅在 dirty = true 或公开条目发生实质变化（含次序）时 epoch 推进 1。
   * 返回防御性浅拷贝的原生快照对象。
   */
  freeze(cases: readonly IndexCase[]): CasebookIndexSnapshot
  /** 定位 shelfmark 在输入 cases 中的索引，找不到返回 -1。 */
  locate(cases: readonly IndexCase[], shelfmark: string): number
  /** 稳定公开 shelfmark 计算。 */
  shelfmarkFor(sessionId: string, question: string): string
}

/** 进程内唯一 Casebook 索引状态机实例；ES 模块缓存保证全进程同一实例。 */
export declare const casebookIndex: CasebookIndex

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

/** 会话草稿的单个问答轮次。 */
export interface CasebookDraftTurn {
  readonly Q: string
  readonly A?: string
}

/** 会话草稿对外暴露的只读快照；直接暴露为原生数组，不含 Fable 内部链表。 */
export interface CasebookDraftSnapshot {
  readonly turns: readonly CasebookDraftTurn[]
}

/** 进程内会话草稿自治存储对象；语义迁移自主仓原 SessionDraft 模块。 */
export declare class SessionDraftStore {
  constructor()
  /** 设置当前轮次问题。若末轮未答则覆写其 Q，末轮已答则追加新轮。 */
  setQ(sessionId: string, q: string): void
  /** 设置当前轮次答案。若无轮次则补入空 Q 轮次，末轮存在则覆写其 A。 */
  setA(sessionId: string, a: string): void
  /** 原子取出并从内存移除指定会话的草稿快照；若不存在则返回 undefined。 */
  tryTake(sessionId: string): CasebookDraftSnapshot | undefined
  /** 幂等清除指定会话的草稿。 */
  clear(sessionId: string): void
  /** 获取草稿末轮问题，若草稿无轮次则返回空字符串。 */
  lastQuestion(draft: CasebookDraftSnapshot): string
  /** 逆向获取草稿中最后一个非空的回答，若无回答则返回 undefined。 */
  lastAnswer(draft: CasebookDraftSnapshot): string | undefined
  /** 按 Qn = ...\nAn = ... 格式化全部轮次文本，末尾无多余换行符。 */
  transcript(draft: CasebookDraftSnapshot): string
}

/** 进程内唯一会话草稿注册表；ES 模块缓存保证全进程同一实例。 */
export declare const sessionDraftStore: SessionDraftStore

/**
 * 进程内 Casebook Fetch 单飞注册表（Package-16，FetchInFlightRegistry）。
 * 追踪同一 (workspaceRoot, shelfmark) 在执行期间的 in-flight 请求，
 * 确保并发调用共享同一个 Promise/Task、校验 storeToken 引用一致性，
 * 并在完成（无论成功或异常/拒绝）后自动从注册表中移除。
 */
export declare class FetchFlightRegistry {
  constructor()
  /**
   * 获取正在执行的 in-flight Promise，或调用 factory 创建并注册新的 in-flight Promise。
   * 若存在正在执行的请求：
   * - storeToken 引用一致（===）时，直接返回该正在执行的 Promise；
   * - storeToken 引用不一致时，抛出 "Casebook fetch flight store binding mismatch" 异常。
   * 当 Promise 结束（成功兑现或抛错拒绝）后，自动从注册表中移除。
   */
  getOrCreate<T = string>(
    workspaceRoot: string,
    shelfmark: string,
    storeToken: unknown,
    factory: () => Promise<T>
  ): Promise<T>
  /**
   * 手动从注册表中移除指定的 in-flight 请求；若存在则返回 true，否则返回 false。
   */
  remove(workspaceRoot: string, shelfmark: string): boolean
  /**
   * 返回当前正在执行的 in-flight 请求数量。
   */
  activeCount(): number
  /**
   * 清空所有正在执行的 in-flight 请求注册（不中断正在执行的异步操作自身）。
   */
  clear(): void
}

/** 进程内唯一 Casebook Fetch 单飞注册表；ES 模块缓存保证全进程同一实例。 */
export declare const fetchFlightRegistry: FetchFlightRegistry


/** Bookkeeper 会话附着只读快照。 */
export interface BookkeeperAttachment {
  readonly txId: string
  readonly ownerSessionId: string
  readonly attachment: string
}

/** 进程内 Bookkeeper 会话附着与提示词单次授权自治对象。 */
export declare class BookkeeperLedger {
  constructor()
  /** 绑定 Bookkeeper 子会话到特定事务与所有者会话。若已存在绑定则原子覆盖并清空旧待办授权。 */
  bind(sessionId: string, txId: string, ownerSessionId: string): void
  /** 解除会话附着，并原子撤销关联的待办提示词授权。 */
  unbind(sessionId: string): void
  /** 查询会话关联的事务 ID。 */
  tryTxId(sessionId: string): string | undefined
  /** 获取会话关联的事务 ID，未附着返回空字符串。 */
  txIdFor(sessionId: string): string
  /** 判定会话是否属于活跃附着的 Bookkeeper worker。 */
  isAttached(sessionId: string): boolean
  /** 获取只读附着快照，未附着返回 undefined。 */
  getAttachment(sessionId: string): BookkeeperAttachment | null
  /** 登记当前附着会话预期的提示词单次授权。仅对处于活跃附着的会话生效并返回 true；未附着直接拒绝返回 false。 */
  authorize(sessionId: string, agent: string, text: string): boolean
  /**
   * 单次消费提示词授权。
   * 仅在会话存在未消费授权、所属附着仍存在且 txId 一致、agent 与 text 均严格逐字节精确匹配时才消费成功（原子删除并返回 true）；
   * 任何参数不匹配、txId 不一致或未授权均返回 false 且保留已有授权。
   */
  tryConsume(sessionId: string, agent: string, text: string): boolean
  /** 清空所有附着与提示词授权状态。 */
  clear(): void
}

/** 进程内唯一 Bookkeeper 会话附着与提示词授权账本实例；ES 模块缓存保证全进程同一实例。 */
export declare const bookkeeperLedger: BookkeeperLedger
