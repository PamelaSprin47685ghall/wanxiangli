/** 一次永久区间替换：替换时拍下的区间 `[anchor, until)` 与摘要。 */
export interface AnchorReplacement {
  readonly anchor: number
  readonly until: number
  readonly summary: string
}

/** 已解析的 view 声明；`thenMap` 为按锚点升序的 `[anchor, summary | null]` 对。 */
export interface AnchorView {
  readonly prefixUntil: number
  readonly thenMap: readonly (readonly [number, string | null])[]
}

export type ParsedView =
  | { readonly ok: true; readonly view: AnchorView }
  | { readonly ok: false; readonly reason: string }

export type ProjectedEntry =
  | { readonly kind: 'kept'; readonly position: number; readonly index: number; readonly cached: boolean }
  | { readonly kind: 'summarized'; readonly position: number; readonly index: number; readonly summary: string; readonly cached: boolean }
  | { readonly kind: 'opening'; readonly position: 0; readonly summary: string; readonly cached: boolean }

export interface Projection {
  /** 投影后的行；`index` 指回输入 `positions` 中代表该行的原消息。 */
  readonly entries: readonly ProjectedEntry[]
  readonly kept: number
  readonly summarized: number
  readonly folded: number
  /** 累计被替换过的锚点，去重升序。 */
  readonly replaced: readonly number[]
}

export interface CompressionMessages {
  /** 严格形状 `{ prefixUntil, thenMap }`；非法时返回第一处原因，不抛出。 */
  parseView(value: unknown): ParsedView
  /** 当前存活锚点：0 永远存活，被替换过的真实锚点退出。 */
  live(anchors: readonly number[], history: readonly AnchorReplacement[]): readonly number[]
  /** 本轮声明产生的新替换（不含 history），按锚点升序；小于 prefixUntil 或已不存活的锚点静默忽略。 */
  plan(anchors: readonly number[], history: readonly AnchorReplacement[], view: AnchorView): readonly AnchorReplacement[]
  /** 按 history 先后折叠输入行；`positions[i]` 为第 i 条消息所属锚点位置。 */
  project(positions: readonly number[], history: readonly AnchorReplacement[], prefixUntil: number): Projection
}

export function Compression(): CompressionMessages
