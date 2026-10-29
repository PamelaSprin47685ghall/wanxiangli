/**
 * wanxiangli/segments — writer 段文件的命名与分组律（CUT-19，durable-events-005/014）。
 *
 * 纯计算：名字的律，以及调用方读出的字节上的成帧与共存裁决（CUT-19-a）。
 * 不读目录、不读写文件、不删除、不加锁、不 fsync、不 rename；一切物理读写与按裁决执行的收敛归调用方。
 * 逐行规范解码来自 wanxiangli/events。
 */
import type { CodecError, EventOutput } from 'wanxiangli/events'

export type WriterIdFault = 'required' | 'pathSegment' | 'segmentSuffix'

export interface SegmentName {
  readonly writerId: string
  readonly ordinal: number
}

export interface WriterFiles {
  readonly writerId: string
  readonly fileNames: readonly string[]
}

export type StreamLayout =
  | { kind: 'segments'; segments: string[] }
  | { kind: 'legacy'; legacy: string }
  | { kind: 'coexisting'; legacy: string; segments: string[] }
  | { kind: 'multipleLegacy'; legacy: string[] }

export type StreamDecodeResult =
  | { ok: true; events: EventOutput[] }
  | { ok: false; error: CodecError }

/** 共存裁决：`series` 段系列为准；`legacy` 旧式为准；`continuation` 段系列后接旧式行；`diverged` 不成立。 */
export type Coexistence =
  | { readonly kind: 'series' | 'legacy' | 'diverged' }
  | { readonly kind: 'continuation'; readonly copiedLines: number }

export declare class WriterSegments {
  /** 四位段号的上界（9999）。 */
  readonly maxOrdinal: number
  /** writerId 不可用的原因；可用时 null。以 `-dddd` 结尾的 id 会与段名混淆，拒绝。 */
  writerIdFault(writerId: string): WriterIdFault | null
  /**
   * `<writerId>-dddd.ndjson`；writerId 为空或含路径分隔符、或序号不在 0..9999 的整数内时抛错。
   * 命名不是创建：降级为完整 stem 的旧式 writer（如 `b-0002`）仍可命名自己的段系列；新建 writer 先查 writerIdFault。
   */
  segmentFileName(writerId: string, ordinal: number): string
  /** `<writerId>.ndjson`；writerId 为空或含路径分隔符时抛错。 */
  legacyFileName(writerId: string): string
  /** 只认恰好四位 ASCII 数字与 `.ndjson`，writer 非空；否则 null。 */
  parseSegmentFileName(name: string): SegmentName | null
  /** 某 writer 名下的段文件（不论是否连续），按名字排序。 */
  seriesOf(writerId: string, names: readonly string[]): string[]
  /**
   * 目录名单 → writer 分组。`-dddd` 名只有在同前缀序号从 0000 起连续时才并入该前缀的段系列，
   * 否则是以完整 stem 为 writer 的旧式文件；旧式文件与段系列可同组。非 `.ndjson` 名忽略。
   */
  groupWriterFiles(names: readonly string[]): WriterFiles[]
  /** 一组文件的逻辑流形态；`coexisting` 由调用方按字节裁决，`multipleLegacy` 不成立。 */
  streamLayout(writerFiles: WriterFiles): StreamLayout
  /**
   * 一条 writer 流文本：空文本是空流；非空须以 LF 结尾，内行不得为空，逐行交 wanxiangli/events 规范解码。
   * 成帧错误为 `NonCanonical`，消息带 label；首个失败即止。
   */
  decodeStream(label: string, text: string): StreamDecodeResult
  /**
   * 旧式文件字节与段系列（按序拼接）字节的共存裁决：旧式是段系列前缀（含相等）→ `series`；
   * 段系列是旧式前缀 → `legacy`；完整规范行续接 → `continuation`，copiedLines 是已复制到段尾的旧式前缀行数。
   * 已复制部分必须逐字节相同，剩余 ID 不得出现在段系列；其余为 `diverged`。
   */
  coexistence(legacyBytes: Uint8Array, seriesBytes: Uint8Array): Coexistence
}
