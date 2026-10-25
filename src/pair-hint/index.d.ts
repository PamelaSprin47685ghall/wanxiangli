/** 用户消息、工具结果与 scope 清理的独立消息协议；输入保持不变。 */

/** 由宿主适配器解码的中立调用；terminalField 仅描述结果所在的可写文本字段。 */
export interface ScopeCall {
  readonly id: string
  readonly tool: string
  readonly terminalField?: string
  readonly resultFor?: string
}
/** 物理消息的只读中立视图；不携带宿主原始对象。 */
export interface ScopeMessage {
  readonly kind: 'user' | 'assistant' | 'result' | 'custom' | 'other'
  readonly operator: boolean
  readonly sideRequest?: boolean
  readonly key?: string
  readonly timestamp?: number
  readonly parts?: readonly ScopeCall[]
  readonly resultFor?: string
  readonly resultField?: string
}
export interface ScopeRetained {
  readonly index: number
  readonly parts: readonly number[] | null
}
export interface ScopeTail {
  readonly kind: 'user' | 'tool'
  readonly index: number
  readonly part: number
  readonly field: string
  readonly tail: string
}
export interface ScopePlan {
  readonly active: boolean
  readonly initialized: boolean
  readonly negotiationRequired: boolean
  readonly pendingKind: 'none' | 'negotiate' | 'askPreviousScope'
  readonly previousScopePending: boolean
  readonly budget: number
  readonly slots: readonly ScopeRetained[]
  readonly hints: readonly ScopeTail[]
  readonly strong: string | null
  readonly weak: string | null
}

export interface PairHintMessages {
  isUnchanged(left: readonly unknown[], right: readonly unknown[]): boolean
  budgetSuffix(budget: number): string
  adjustBudgetForKpi(estimatedNextScopeBudget: number, kpiCompletion: 'not_started' | 'far_below' | 'partially_met' | 'met' | 'exceeded' | 'not_applicable'): number
  turnBudget(sessionId: string): number
  isInitialized(sessionId: string): boolean
  startTurn(sessionId: string): void
  resetSession(sessionId: string, budget: number): void
  clearSession(sessionId: string): void
  writeUserHint(message: unknown, texts: readonly string[]): unknown
  writeToolResultHint(message: unknown, texts: readonly string[]): unknown
  stripKnownHints(message: unknown, texts: readonly string[]): unknown
  userCanCarryHint(message: unknown): boolean
  toolCanCarryHint(message: unknown): boolean
  planRequest(sessionId: string, neutralMessages: readonly ScopeMessage[], language?: 'en' | 'zh-CN'): ScopePlan
  planFilter(neutralMessages: readonly ScopeMessage[]): readonly ScopeRetained[]
  appendTailOnce(content: unknown, tail: string): unknown
  bindDelegation(recipient: string, delegator: string): void
  askNegotiation(recipient: string, questions: string, language?: 'en' | 'zh-CN'): {ok:boolean, receipt?: string, delegator?: string, questions?: string, reason?: string}
  prepareNegotiationReply(receipt: string, answer: string, language?: 'en' | 'zh-CN'): {ok:boolean, recipient?:string, steer?:string, first?:boolean, reason?:string}
  completeNegotiationReply(receipt: string): boolean
  confirmNegotiationSteer(receipt: string, recipient: string): boolean
  negotiationRequired(recipient: string): boolean
  rememberSystem(sessionId: string, system: readonly string[]): void
  rememberMessages(sessionId: string, messages: readonly unknown[]): void
  rememberModel(sessionId: string, model: unknown): void
  modelFor(sessionId: string): unknown
  startTemporary(tempId: string, delegatorId: string): { ok: boolean, reason?: string }
  startTemporaryFromFrozen(tempId: string, snapshot: unknown): { ok: boolean, reason?: string }
  modelForTemporary(tempId: string): unknown
  isTemporary(sessionId: string): boolean
  finishTemporary(tempId: string): void
  recordToolViolation(tempId: string): void
  toolViolationCount(tempId: string): number
  forgetSession(sessionId: string): void
  projectSystem(tempId: string, system: readonly string[]): readonly string[] | null
  projectMessages(tempId: string, question: unknown): readonly unknown[] | null
  pendingKind(sessionId: string): 'none' | 'negotiate' | 'askPreviousScope'
  isPreviousScopePending(sessionId: string): boolean
  hasPreviousScope(sessionId: string): boolean
  setHasPreviousScope(sessionId: string, value: boolean): void
  beginAskPreviousScope(sessionId: string): void
  askPreviousScope(sessionId: string, questions: string, receipt?: string): { ok: boolean, receipt?: string, first?: boolean, replayed?: boolean, reason?: string }
  preparePreviousScopeReply(receipt: string, sessionId: string, answer: string, language?: 'en' | 'zh-CN'): { ok: boolean, recipient?: string, steer?: string, reason?: string }
  confirmPreviousScopeSteer(receipt: string, sessionId: string): boolean
}
export function PairHint(): PairHintMessages
