/**
 * wanxiangli/scope-retention — Scope lifecycle annotation (keep quota, not turn count).
 * See common law «Scope». Flat kind enum + optional fields; host validates combinations.
 */

export type ScopeKind = 'resetScope' | 'keepLast' | 'removeLast' | 'meToo'

export type ScopeAnnotationInput = {
  kind: ScopeKind
  oldScopeVerboseVerbatim?: string
  newScopeGoal?: string
  newScopeRetentionBudget?: number
  replacement?: string
}

export declare const MaxRetentionBudget: 48

export declare function isExemptTool(name: string): boolean

export declare function parseScopeAnnotation(raw: unknown):
  | { tag: 'Ok'; fields: unknown }
  | { tag: 'Error'; fields: [string] }
  // Fable Result compiles variously; prefer scopeRetention.apply which returns {ok, reason?}

export declare function validateScopeFields(annotation: unknown):
  | { tag: 'Ok'; fields: null }
  | { tag: 'Error'; fields: [string] }

export interface ScopeRetentionPort {
  apply(
    sessionId: string,
    epochId: string,
    toolName: string,
    providerRunId: string,
    toolCallId: string,
    beatId: string,
    scope: ScopeAnnotationInput
  ): { ok: boolean; reason?: string; kind?: ScopeKind; remaining?: number | null; reanchor?: boolean; decremented?: boolean; beatId?: string; replacement?: string; removeStreak?: number; advisorDue?: boolean; exempt?: boolean }
  status(sessionId: string): { known: boolean; epoch?: string; remaining?: number | null; removeStreak: number; advisorDue: boolean }
  projection(sessionId: string, beatId: string): { retracted: boolean; beatId?: string; replacement?: string; streak?: number }
  reset(sessionId: string, epochId: string): void
  clear(sessionId: string): void
  journal(sessionId: string): ReadonlyArray<Record<string, unknown>>
  restore(sessionId: string, epochId: string, events: ReadonlyArray<Record<string, unknown>>): void
}

export declare function ScopeRetention(): ScopeRetentionPort
export declare const scopeRetention: ScopeRetentionPort
