/**
 * wanxiangli/association — the Work ↔ Satellite (Companion) session link law
 * (vibe-fs CUT-12 sub-loop 1; managed-session-lifecycle, HOST-008, COMPANION-002).
 *
 * Pure computation. The caller owns the association map, answers the keyed lookups
 * (both entries, main's existing satellite of the kind) and writes both entries of an
 * accepted link together, before the satellite's first prompt.
 */
export type Entry =
  | { readonly kind: 'Work'; readonly parent?: string | null }
  | { readonly kind: 'Satellite'; readonly owner: string; readonly satelliteKind: string }

export interface LinkInput {
  readonly main: string
  readonly satellite: string
  readonly satelliteKind: string
  readonly mainEntry: Entry | null
  readonly satelliteEntry: Entry | null
  /** The satellite of `satelliteKind` main already has, or null. */
  readonly existingSatellite: string | null
  /** The parent the caller proposes for main, or null to keep main's recorded parent. */
  readonly parentOfMain: string | null
}

export type LinkVerdict =
  | { readonly verdict: 'link'; readonly mainParent: string | null }
  | { readonly verdict: 'reject'; readonly rejection: 'SelfLink'; readonly session: string }
  | { readonly verdict: 'reject'; readonly rejection: 'CompanionWouldRecurse'; readonly companion: string }
  | { readonly verdict: 'reject'; readonly rejection: 'AlreadyLinkedToOther'; readonly existing: string; readonly proposed: string }
  | { readonly verdict: 'reject'; readonly rejection: 'CompanionClaimedByOther'; readonly owner: string; readonly proposed: string }
  | { readonly verdict: 'reject'; readonly rejection: 'SatelliteKindConflict'; readonly proposed: string }

export declare class SessionAssociationLaw {
  readonly contractVersion: 1
  link(input: LinkInput): LinkVerdict
}

export interface ActiveRunBindingRecord {
  readonly sessionId: string
  readonly runId?: string | null
  readonly authorityRootUserMessageId?: string | null
  readonly physicalUserMessageId?: string | null
  readonly continuationMessageIds: readonly string[]
  readonly role?: string | null
  readonly directory?: string | null
  readonly inheritedAuthorityOwner?: string | null
}

export interface ProjectedRunBinding {
  readonly activeRootId?: string | null
  readonly canonicalRole?: string | null
  readonly inheritedOwnerSessionId?: string | null
  readonly inheritedOwnerRootId?: string | null
  readonly inheritedOwnerRole?: string | null
  readonly lanePhysicalId?: string | null
}

export declare class TurnBindingStore {
  bindUserMessage(sessionId: string, physical: string, agentRole?: string | null): boolean
  bindContinuationUserMessage(sessionId: string, physical: string): boolean
  bindPhysicalUserMaterial(sessionId: string, physical: string): boolean
  bindActiveRun(binding: ActiveRunBindingRecord): boolean
  activeRunBinding(sessionId: string, projectedSummary?: ProjectedRunBinding | null): ActiveRunBindingRecord | null
  tryPhysicalUserMessage(sessionId: string): string | null
  clearSession(sessionId: string): boolean
  getUserMessageBinding(sessionId: string): string | null
  getContinuationMessageIds(sessionId: string): readonly string[]
  getActiveBinding(sessionId: string): ActiveRunBindingRecord | null
  allUserMessageBindings(): readonly { readonly sessionId: string; readonly physical: string }[]
  snapshot(sessionId: string): {
    readonly sessionId: string
    readonly userMessageBinding: string | null
    readonly activeBinding: ActiveRunBindingRecord | null
    readonly continuationMessageIds: readonly string[]
  } | null
  clearAll(): void
}

export declare const turnBindingStore: TurnBindingStore
