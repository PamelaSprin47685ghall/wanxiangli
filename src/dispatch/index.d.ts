/**
 * wanxiangli/dispatch — 派发认领账的纯规则（CUT-11）。
 *
 * 认领作用域与 PromptKey 原文、ClaimSequence 消费、四态结算的投影编辑、精确 occasion 准入、
 * 崩溃恢复的物理证据核对。无状态；投影记录、哈希、journal 与 Host 发送归宿主。
 */

export type ClaimEvent = 'Submit' | 'Accept' | 'Abandon'

export type LedgerEdit =
  | 'RecordReceipt'
  | 'DropPending'
  | 'LandOccasion'
  | 'LandExact'
  | 'RecordContinuation'
  | 'ClearOccasion'

export interface ScopeInput {
  readonly sessionId: string
  /** null/undefined = 还没有逻辑运行（根认领）。 */
  readonly logicalRunId?: string | null
  /** 宿主的来源标签，原样参与。 */
  readonly origin: string
  readonly payloadDigest: string
}

export interface KeyInput extends ScopeInput {
  readonly authorityRoot?: string | null
  /** ≥ 1 的安全整数。 */
  readonly claimSequence: number
}

export interface RecoveryMessage {
  readonly role: string
  readonly promptKey?: string | null
  readonly id: string
}

export type RecoveryVerdict =
  | { readonly kind: 'Proven'; readonly physicalUserMessageId: string }
  | { readonly kind: 'StillPending'; readonly hasReceipt: boolean }

export type SendAnswer = 'AdmittedWithReceipt' | 'AdmittedWithPhysicalMessage' | 'Retryable' | 'Fatal' | 'AcceptanceUnknown'

export interface SendVerdict {
  /** Submit：只记回执；SubmitThenAccept：回执后接真实物理 id；Abandon：确定拒绝显式放弃；KeepPending：结局未知，什么都不写。 */
  readonly ledger: 'Submit' | 'SubmitThenAccept' | 'Abandon' | 'KeepPending'
  /** 只有确定未发送才允许归还 exact quiescence permit。 */
  readonly definitelyNotSent: boolean
  readonly detached: 'OwnedSettled' | 'Refused' | 'OutcomeUnknown'
}

export declare class Dispatch {
  constructor()
  readonly contractVersion: 1
  /** 恢复只核对最近这么多条消息（50）。 */
  readonly recoveryTailWindow: number
  claimScope(input: ScopeInput): string
  /** 宿主对其做 sha256 得到 PromptKey；不含 agent、peer 或 model。 */
  promptKeyMaterial(input: KeyInput): string
  /** consumed：该作用域已消费的计数，null = 从未认领。 */
  nextClaimSequence(consumed: number | null): number
  alreadyClaimed(consumed: number | null): boolean
  /** pending=false（已落地、已放弃或从未认领）时返回空数组：不改投影。 */
  settle(input: { event: ClaimEvent; pending: boolean; continuation: boolean }): readonly LedgerEdit[]
  occasionAdmitted(input: { pendingSameOccasion: boolean; landedOrigin?: string | null; origin: string }): boolean
  answer(sent: SendAnswer): SendVerdict
  /** messages 按时间先后；只看最后 recoveryTailWindow 条、role=user、PromptKey 完全一致。 */
  recover(input: { promptKey: string; hasReceipt: boolean; messages: readonly RecoveryMessage[] }): RecoveryVerdict
}
