/** 用户消息、工具结果与 scope 清理的独立消息协议；输入保持不变。 */
export interface PairHintMessages {
  budgetSuffix(budget: number): string
  appendText(content: unknown, addition: string): unknown
  appendUserReminder(content: unknown): unknown
  appendBudgetReminder(content: unknown, budget: number): unknown
  injectToolResultContent(content: unknown, toolName: string, initialized: boolean, budget: number): unknown
  initializeUserMessages(messages: readonly unknown[]): unknown[]
  injectToolResults(messages: readonly unknown[], initialized: boolean, budget: number): unknown[]
  stripContradictions(messages: readonly unknown[]): unknown[]
  filter(messages: readonly unknown[]): unknown[]
  appendWeakSteer(messages: readonly unknown[]): unknown[]
  promptKey(message: unknown): string
  lastPromptIndex(messages: readonly unknown[]): number
  hasResetSinceLastPrompt(messages: readonly unknown[]): boolean
  isScopePrompt(message: unknown): boolean
  endsWithSideRequest(messages: readonly unknown[]): boolean
  isUnchanged(left: readonly unknown[], right: readonly unknown[]): boolean
  turnBudget(sessionId: string): number
  isInitialized(sessionId: string): boolean
  startTurn(sessionId: string): void
  observePrompt(sessionId: string, message: unknown, hasReset: boolean): void
  setInitialized(sessionId: string, initialized: boolean): void
  resetSession(sessionId: string, budget: number): void
  clearSession(sessionId: string): void
  prepareRequest(sessionId: string, messages: readonly unknown[], injectExistingToolResults: boolean): unknown[]
  toolResultFor(sessionId: string, toolName: string, content: unknown): unknown
  writeUserHint(message: unknown, texts: readonly string[]): unknown
  writeToolResultHint(message: unknown, texts: readonly string[]): unknown
  stripKnownHints(message: unknown, texts: readonly string[]): unknown
  userCanCarryHint(message: unknown): boolean
  toolCanCarryHint(message: unknown): boolean
}
export function PairHint(): PairHintMessages
