/**
 * wanxiangli/admission-queue — 执行准入等待队列 owner（CUT-10）。
 *
 * 每个会话至多一个等待需求；裁决 FIFO 序号、有界容量、同一逻辑操作复用、更新物理世代替代旧需求、
 * 精确 node 认领与撤回。不选模型、不签发许可、不持有容量账本、不完成调用方的等待者、不计数。
 */

/** 本队列签发的冻结 node。只有签发它且仍以它为该会话当前需求的队列认得它。 */
export interface AdmissionNode<P = unknown> {
  readonly nodeId: number
  readonly fence: number
  readonly sequence: number
  readonly sessionId: string
  readonly physicalUserMessageId: string
  /** 调用方入队时附带的不透明数据，原样保存。 */
  readonly payload: P
}

export interface Enqueued<P = unknown> {
  /** Queued：新需求已排到队尾；Reused：同一逻辑操作，交还原 node；Full：队满，未入队。 */
  readonly kind: 'Queued' | 'Reused' | 'Full'
  readonly node: AdmissionNode<P> | null
  /** 被同会话更新物理世代替代并移出的旧需求（调用方据此结束它的等待者），否则 null。 */
  readonly superseded: AdmissionNode<P> | null
}

export interface Withdrawn<P = unknown> {
  /** Applied：已撤回；AlreadyApplied：该会话没有等待需求；StaleFence：物理消息不符，未改状态。 */
  readonly outcome: 'Applied' | 'AlreadyApplied' | 'StaleFence'
  readonly node: AdmissionNode<P> | null
}

export declare class AdmissionQueue<P = unknown> {
  /** bound 默认 32，必须是正整数。 */
  constructor(bound?: number)
  readonly contractVersion: 1
  readonly bound: number
  enqueue(sessionId: string, physicalUserMessageId: string, payload: P): Enqueued<P>
  current(sessionId: string): AdmissionNode<P> | null
  /** 认领本队列当前的 node：移出并交还 true；其余（null、伪造、旧 node）交还 false 且不改状态。 */
  take(node: AdmissionNode<P> | null): boolean
  /** 撤回该会话当前需求；给了 physicalUserMessageId 时只撤回与之一致者。 */
  withdraw(sessionId: string, physicalUserMessageId?: string | null): Withdrawn<P>
  /** 全部等待需求，按到达序号。 */
  snapshot(): readonly AdmissionNode<P>[]
  /** 清空并按到达序号交还被移出的全部 node。 */
  drain(): readonly AdmissionNode<P>[]
  count(): number
}
