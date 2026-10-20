/** 产生交付的那一次工具调用。只有带围栏的格才是交付证据。 */
export interface DeliveryFence {
  readonly providerRun: string
  readonly toolCallId: string
}

/** 交还给接收方的一段材料；key 是去重身份，text 原样保留。 */
export interface DeliveryPiece {
  readonly key: string
  readonly text: string
}

export type ClaimRequest =
  | { readonly mode: 'peek' }
  | { readonly mode: 'cache' }
  | { readonly mode: 'run'; readonly providerRun: string }

/** 不透明凭据：只能由签发它的实例兑现一次。 */
export interface DeliveryTicket {
  /** claim 时该格的视图，供组合者选材；不能改写格。 */
  readonly view: unknown
}

export interface DeliveryMessages {
  /** 暂存一份仅供呈现的视图；不会覆盖已有的交付格。 */
  stage(sessionId: string, view: unknown): void
  /** 记录一次带围栏的交付，替换该会话现有的格。 */
  deliver(sessionId: string, fence: DeliveryFence, view: unknown): void
  /** 取走交付格的视图；暂存格保持原样，返回 null。 */
  take(sessionId: string): unknown
  /** 交付格的视图；暂存格不算，返回 null。 */
  peek(sessionId: string): unknown
  /** 当前格的视图，无论交付或暂存；仅供呈现。 */
  peekCached(sessionId: string): unknown
  fence(sessionId: string): DeliveryFence | null
  /** 已交还过的材料身份。 */
  returned(sessionId: string): string[]
  /**
   * peek：不取走、不推进游标；cache：只取走暂存格；run：只取走该 provider run 的交付格。
   * 不符合条件返回 null，格保持原样。
   */
  claim(sessionId: string, request: ClaimRequest): DeliveryTicket | null
  /** 以组合者按 claim 视图选出的材料兑现凭据，返回尚未交还的部分。 */
  handOff(ticket: DeliveryTicket, candidates: readonly DeliveryPiece[], assistant: string | null): DeliveryPiece[]
  clear(sessionId: string): void
  clearReturned(sessionId: string): void
  clearAll(): void
}

export function Delivery(): DeliveryMessages
