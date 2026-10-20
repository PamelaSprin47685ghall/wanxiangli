/** 任期过滤的一条输入消息；游标是该宿主消息首次被 XTrace 观测到的序号。 */
export interface TenureMessage {
  /** 宿主稳定消息 id；没有时为 null。 */
  readonly id: string | null
  readonly role: string
  /** 宿主或插件合成的行（非物理消息）。 */
  readonly synthetic: boolean
  /** 是否带语义内容（解码后至少一个 part）。 */
  readonly semantic: boolean
  /** 首次观测游标；尚未捕获时为 null。只有带 id 的消息才可能有游标。 */
  readonly cursor: bigint | null
}

/** 一条通用投影意图的规划视图；行内容对本规则不透明，同值由所有者给出的指纹判定。 */
export interface LayoutIntent {
  readonly kind: 'ReplaceMessageBase' | 'InsertMessageRows'
  readonly key: string
  /** 仅 InsertMessageRows：基底下标（插在该行之前；等于基底长度即末尾）；null 表示 append。 */
  readonly anchor?: number | null
  /** 该意图携带的行数。 */
  readonly rows: number
  /** 行内容（含宿主元数据）的规范指纹；相等当且仅当行相等。 */
  readonly fingerprint: string
}

/** 输出的一行来自哪里：intent 为 null 是原始基底第 row 行，否则是 intents[intent] 的第 row 行。 */
export interface LayoutRow {
  readonly intent: number | null
  readonly row: number
}

export type Layout =
  | {
      readonly ok: true
      /** 规范顺序下被采用的意图下标：替换基底在先，随后按 anchor（append 最后）再按 key。 */
      readonly order: readonly number[]
      readonly rows: readonly LayoutRow[]
    }
  | { readonly ok: false; readonly conflict: 'ConflictingMessageBase' }
  | { readonly ok: false; readonly conflict: 'ConflictingMessageRows'; readonly key: string }

export type Plan =
  | { readonly ok: true; readonly order: readonly number[] }
  | { readonly ok: false; readonly conflict: 'ConflictingMessageBase' }
  | { readonly ok: false; readonly conflict: 'ConflictingMessageRows'; readonly key: string }

export interface ProjectionMessages {
  /**
   * 当前任期可见的物理消息：非合成 user 原样保留；assistant/tool 只在首次观测 `>= openingCursor`
   * 或带 id 尚未捕获时保留；合成行与其他角色剥离。无 id 却带语义内容的交换抛错。
   * 返回保留消息的输入下标（升序、冻结）。
   */
  tenure(messages: readonly TenureMessage[], openingCursor: bigint): readonly number[]
  /**
   * 规划并布局通用投影意图：同批不同基底、同键不同值显式冲突；同值重复幂等；结果与注册顺序无关。
   * 锚点超出（替换后）基底长度时抛错。
   */
  layout(intents: readonly LayoutIntent[], baseLength: number): Layout
  /** 只规划（与 layout 的 order/冲突相同），不校验锚点是否落在基底之内。 */
  plan(intents: readonly LayoutIntent[]): Plan
}

export function Projection(): ProjectionMessages
