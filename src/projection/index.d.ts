/** 任期过滤的一条输入消息。归属只看屏障、工具调用身份和后任身份。 */
export interface TenureMessage {
  /** 宿主稳定消息 id；没有时为 null。有 id 本身不构成后任内容。 */
  readonly id: string | null
  readonly role: string
  /** 宿主或插件合成的行（非物理消息）。 */
  readonly synthetic: boolean
  /** 是否带语义内容（解码后至少一个 part）。 */
  readonly semantic: boolean
  /** 首次观测游标；尚未捕获时为 null。游标不决定后任可见性。 */
  readonly cursor?: bigint | null
  /** 这条消息发出的工具调用；没有时为 null。 */
  readonly toolCallId: string | null
  /** 这条消息所回答的工具调用；没有时为 null。 */
  readonly resultFor: string | null
  /** 已标明的任期；无法归属时为 null，不得放行。 */
  readonly tenureId: string | null
}

export interface TenureBarrier {
  readonly toolCallId: string
  readonly successorTenureId: string
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

/** 退休 attempt 判定的一条请求消息（宿主线格式顺序）。 */
export interface RetiredRequestMessage {
  /** 宿主角色；按不区分大小写的 "user" 识别用户消息；未知时为 null。 */
  readonly role: string | null
  /** 宿主稳定消息 id；没有时为 null。 */
  readonly id: string | null
  /** 该消息是否带退休切点那次工具调用的 call 或 result。没有投影切点时恒为 false。 */
  readonly cut: boolean
  /** 以该消息为物理用户消息的 ChatExecution 接纳证据的权威根 id；没有时为 null。 */
  readonly accepted: string | null
}

export interface RetiredRequest {
  /** 当前 work 是否有一次 Relayed 且带投影切点的退休。 */
  readonly relayed: boolean
  /** 本次请求是否已被 ChatExecution 接纳。 */
  readonly acceptedRequest: boolean
  /** 会话当前逻辑运行的权威根 user 消息 id；没有时为 null。 */
  readonly activeRoot: string | null
  /** 该退休的管理者门控 nudge 被接纳的物理 user 消息 id；没有时为 null。 */
  readonly gatePhysical: string | null
  readonly messages: readonly RetiredRequestMessage[]
}

/** provider 投影的一个部件。线格式视图的 tool-call/tool-result 必须带 callId，语义视图不得带。 */
export type ProviderPart =
  | { readonly kind: 'text' | 'reasoning'; readonly text: string }
  | { readonly kind: 'tool-call'; readonly callId?: string; readonly name: string; readonly args: string }
  | { readonly kind: 'tool-result'; readonly callId?: string; readonly result: string }
  | { readonly kind: 'media'; readonly mediaType: string | null; readonly contentDigest: string }

export interface ProviderMessage {
  readonly role: string
  readonly parts: readonly ProviderPart[]
}

export interface ProviderProjectionView {
  readonly provider?: string | null
  readonly model?: string | null
  readonly variant?: string | null
  readonly tools: readonly string[]
  readonly system: readonly string[]
  readonly messages: readonly ProviderMessage[]
}

export interface ProjectionMessages {
  /**
   * 后任可见的消息下标。屏障标出的工具调用及其结果，以及二者中较晚者之前的消息，一律不可见。
   * 之后只保留 tenureId 等于后任、且不是合成行的消息。找不到调用或结果时返回空数组。
   * 宿主 id、游标、角色都不能单独放行。返回升序、冻结的下标。
   */
  tenure(messages: readonly TenureMessage[], barrier: TenureBarrier): readonly number[]
  /**
   * 规划并布局通用投影意图：同批不同基底、同键不同值显式冲突；同值重复幂等；结果与注册顺序无关。
   * 锚点超出（替换后）基底长度时抛错。
   */
  layout(intents: readonly LayoutIntent[], baseLength: number): Layout
  /** 只规划（与 layout 的 order/冲突相同），不校验锚点是否落在基底之内。 */
  plan(intents: readonly LayoutIntent[]): Plan
  /**
   * 这次请求是否仍属于已被 Relayed 退休的 attempt（宿主应中断并清空请求）。
   * 归属后任的证据：最后一条 user 消息（须有 id）在切点之后且是当前逻辑运行的根、或是门控 nudge
   * 的接纳物理消息、或在切点之后且请求已被接纳；或切点已不在线格式中且其接纳证据的根正是当前根。
   */
  retired(request: RetiredRequest): boolean
  /** 线格式投影的规范字节（含 callId；同一会话内逐字节比较与封印摘要的原文）。 */
  wire(projection: ProviderProjectionView): string
  /** 一条线格式消息的规范字节，恰是 wire 输出中对应的消息元素。 */
  wireMessage(message: ProviderMessage): string
  /** 语义投影的规范字节；部件带 callId 即拒绝。 */
  semantic(projection: ProviderProjectionView): string
}

export function Projection(): ProjectionMessages
