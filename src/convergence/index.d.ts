/**
 * wanxiangli/convergence — 多 writer 事实流的结构归并（CUT-19）。
 *
 * 纯计算：不读写文件、不加锁、不访问 Git、不解释业务事件。
 * 同 id 的身份裁决委托 wanxiangli/events 的 CanonicalEventCodec。
 */
import type { CodecError, EventInput } from 'wanxiangli/events'

/** 一个 writer 的完整逻辑流：`[writerId, 按追加顺序排列的事件]`。 */
export type WriterStream<E extends EventInput = EventInput> = readonly [writerId: string, events: readonly E[]]

export type ConvergenceError =
  | CodecError
  | { code: 'MissingParent'; eventId: string }
  | { code: 'NonCanonical'; reason: string }
  | { code: 'MalformedEnvelope'; reason: string }

/**
 * `events` 是调用方传入的事件对象本身（按引用，不复制）。
 * `readyComparisons` 只是本次归并的就绪堆比较次数，用于成本观测，不是权威事实。
 */
export type ConvergenceResult<E extends EventInput = EventInput> =
  | { ok: true; events: E[]; readyComparisons: number }
  | { ok: false; error: ConvergenceError; readyComparisons: number }

export declare class KWayMerge {
  /**
   * 完整历史归并。各 writer 内顺序不变；就绪 head 之间按 EventId 文本序，parent 先于 child；
   * 同 id 同字节去重，异字节 IdentityCollision；集合内外任何缺失 parent 都是 MissingParent；
   * 同一 writerId 出现两次是 NonCanonical（调用方须先聚合段）。
   */
  merge<E extends EventInput>(streams: readonly WriterStream<E>[]): ConvergenceResult<E>
  /**
   * retention 窗口归并：整个保留集合中都不存在的 parent 视为窗口外的已满足边界；
   * 集合内存在的依赖仍参与排序与成环检测。
   */
  mergeRetained<E extends EventInput>(streams: readonly WriterStream<E>[]): ConvergenceResult<E>
}
