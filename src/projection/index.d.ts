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

export interface ProjectionMessages {
  /**
   * 当前任期可见的物理消息：非合成 user 原样保留；assistant/tool 只在首次观测 `>= openingCursor`
   * 或带 id 尚未捕获时保留；合成行与其他角色剥离。无 id 却带语义内容的交换抛错。
   * 返回保留消息的输入下标（升序、冻结）。
   */
  tenure(messages: readonly TenureMessage[], openingCursor: bigint): readonly number[]
}

export function Projection(): ProjectionMessages
