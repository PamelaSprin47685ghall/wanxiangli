/** wanxiangli/fission-group — one Fission group's lane set, convergence and single terminal (INTRA-PARALLEL). Plain data in, frozen plain data out. */

export type FissionHeld = null | 'same' | 'different'
export type FissionLaneSession = 'match' | 'mismatch' | 'absent'
export type FissionTerminalKind = 'Open' | 'Converged' | 'Failed'

export interface FissionProgress {
  /** lane indices whose work view has materialized */
  workedLanes: readonly number[]
  /** for every pre-Fission completion: the lane indices it was delivered to */
  deliveries: readonly (readonly number[])[]
}

export type FissionGroupEvent =
  | { event: 'admitted'; existing: FissionHeld; laneCount: number; sessionCount: number; promptCount: number; ownerActive: boolean }
  | { event: 'laneMaterialized'; laneCount: number | null; laneIndex: number; laneSession: FissionLaneSession; work: FissionHeld }
  | { event: 'completionCaptured'; laneCount: number | null; preFission: boolean; captured: FissionHeld }
  | { event: 'completionDelivered'; laneCount: number | null; laneIndex: number; captured: boolean }
  | { event: 'externalAffinityBound'; laneCount: number | null; laneIndex: number; bound: FissionHeld }
  | { event: 'takeover'; laneCount: number | null; laneIndex: number; laneSession: FissionLaneSession; progress: FissionProgress; takeover: FissionHeld }
  | { event: 'converged'; laneCount: number | null; terminal: FissionTerminalKind; terminalSame: boolean; progress: FissionProgress; takeoverLane: null | 'match' | 'mismatch' }
  | { event: 'failed'; laneCount: number | null; terminal: FissionTerminalKind; terminalSame: boolean }

export type FissionGroupRejection =
  | 'UnknownGroup'
  | 'ConflictingGroup'
  | 'DuplicateOwnerActive'
  | 'InvalidLane'
  | 'LaneSessionMismatch'
  | 'ConflictingLaneWork'
  | 'ConflictingTakeover'
  | 'ConvergenceIncomplete'
  | 'TerminalAlreadySet'

export type FissionGroupVerdict =
  | { readonly verdict: 'set' }
  | { readonly verdict: 'keep' }
  | { readonly verdict: 'reject'; readonly rejection: FissionGroupRejection }

export declare class FissionGroupLaw {
  constructor()
  judge(input: FissionGroupEvent): FissionGroupVerdict
  convergenceReady(input: { laneCount: number; progress: FissionProgress }): boolean
  parsePrompts(prompts: readonly string[]): { readonly lanes: number } | { readonly rejection: 'TooFewLanes' } | { readonly rejection: 'EmptyLanePrompt'; readonly index: number }
  /** `lane` null = pre-Fission broadcast */
  routeCompletion(input: { laneCount: number; lane: number | null }): readonly number[]
  mergeOrder(laneCount: number): readonly number[]
  finalLane(laneCount: number): number | null
  successor(input: { laneCount: number; laneIndex: number; closed: readonly number[] }): number | null
  settle(input: { stage: 'lane' | 'takeover'; observation: 'OngoingExecution' | 'NeedsContinuation' | 'ProviderFailed' | 'DegenerationInterrupted' | 'ExternalAbort' | 'Completed' }): { readonly decision: 'yield' | 'fail' | 'materialize' | 'complete' }
}

export declare class FissionLaneQuiescenceGate {
  constructor()
  /** Mark a specific lane under a group as quiescent. Returns true if state changed, false if already quiescent (idempotent). */
  enterQuiescent(groupId: string, laneId: string): boolean
  /** Alias for enterQuiescent. */
  markQuiescent(groupId: string, laneId: string): boolean
  /** Mark a specific lane under a group as active / non-quiescent. Returns true if it was previously quiescent. */
  leaveQuiescent(groupId: string, laneId: string): boolean
  /** Alias for leaveQuiescent. */
  markActive(groupId: string, laneId: string): boolean
  /** Check if a specific lane under a group is currently quiescent. */
  isLaneQuiescent(groupId: string, laneId: string): boolean
  /** Check if an entire group has converged to quiescence (all lanes quiescent, minimum 2 lanes). */
  isGroupQuiescent(groupId: string, expectedLaneCount?: number): boolean
  /** Check if given array of lanes are all quiescent under the group (minimum 2 lanes). */
  areLanesQuiescent(groupId: string, laneIds: readonly string[]): boolean
  /** Get array of lane IDs currently quiescent in the group. */
  getQuiescentLanes(groupId: string): readonly string[]
  /** Get total recorded lane count for the group. */
  getLaneCount(groupId: string): number
  /** Clear state for a specific lane. Returns true if lane existed. */
  clearLane(groupId: string, laneId: string): boolean
  /** Clear all state for a group. Returns true if group existed. */
  clearGroup(groupId: string): boolean
  /** Clear all groups and lanes. */
  clearAll(): void
}

export declare const fissionLaneQuiescenceGate: FissionLaneQuiescenceGate

export interface FissionLaneRecord {
  readonly GroupId: string
  readonly OwnerSessionId: string
  readonly LaneIndex: number
  readonly LaneCount: number
}

export interface FissionOwnerCleanupResult {
  readonly RemovedLanes: readonly string[]
  readonly RemovedGroupIds: readonly string[]
}

export declare class FissionLaneRegistry {
  constructor()
  bindLane(groupId: string, ownerSessionId: string, laneIndex: number, laneCount: number, laneSessionId: string): void
  unbindLane(laneSessionId: string): boolean
  tryLane(laneSessionId: string): FissionLaneRecord | undefined
  tryOwner(laneSessionId: string): string | undefined
  logicalOwner(sessionId: string): string
  clearOwner(ownerSessionId: string): FissionOwnerCleanupResult
  clearOwnerLanes(ownerSessionId: string): readonly string[]
  hydrateFromDurable(resolve: (laneSessionId: string) => FissionLaneRecord | undefined): void
  clearAll(): void
  getLaneCount(): number
}

export declare const fissionLaneRegistry: FissionLaneRegistry
