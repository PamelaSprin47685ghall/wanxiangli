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

/**
 * claim 的请求。围栏由本对象自己比对，调用方不再自行查看再取走。
 * - `peek`：只读观察当前格，不比较围栏，不取走，不推进游标。
 * - `observe`：只读观察带着同一完整围栏的交付格。
 * - `cache`：取走暂存格（没有围栏）。
 * - `run`：取走带着同一完整围栏的交付格；providerRun 与 toolCallId 必须同时相同。
 */
export type ClaimRequest =
  | { readonly mode: 'peek' }
  | { readonly mode: 'observe'; readonly fence: DeliveryFence }
  | { readonly mode: 'cache' }
  | { readonly mode: 'run'; readonly fence: DeliveryFence }

/** claim 失败的原因。 */
export type ClaimFailure = 'no-cell' | 'fence-mismatch' | 'not-staged'

/** claim 的结果：要么给出凭据，要么给出确切的不匹配原因。 */
export type ClaimOutcome =
  | { readonly ok: true; readonly ticket: DeliveryTicket }
  | { readonly ok: false; readonly reason: ClaimFailure }

/** 不透明凭据：只能由签发它的实例兑现一次。 */
export interface DeliveryTicket {
  /** claim 时该格的视图，供组合者选材；不能改写格。 */
  readonly view: unknown
  /** 产生该声明的调用围栏；暂存格为 null。 */
  readonly fence: DeliveryFence | null
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
   * 取得一份凭据。围栏的完整判断在本对象内一次完成：
   * 不匹配时返回 `{ ok: false, reason }`，格与游标都不动。
   * claim 不消费：取走与游标推进发生在 handOff 兑现时。
   */
  claim(sessionId: string, request: ClaimRequest): ClaimOutcome
  /** 以组合者按凭据视图选出的材料兑现凭据，返回尚未交还的部分。 */
  handOff(ticket: DeliveryTicket, candidates: readonly DeliveryPiece[]): DeliveryPiece[]
  clear(sessionId: string): void
  clearReturned(sessionId: string): void
  clearAll(): void
}

export function Delivery(): DeliveryMessages
