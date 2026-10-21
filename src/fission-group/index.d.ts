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
}
