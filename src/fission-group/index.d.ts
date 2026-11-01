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

export interface IDisposableHandle {
  dispose?(): void
  Dispose?(): void
}

export declare class FissionRuntime {
  constructor(laneRegistry?: FissionLaneRegistry)
  readonly LaneRegistry: FissionLaneRegistry
  bindLane(groupId: string, ownerSessionId: string, laneIndex: number, laneCount: number, laneSessionId: string): void
  unbindLane(laneSessionId: string): boolean
  tryLane(laneSessionId: string): FissionLaneRecord | undefined
  tryOwner(laneSessionId: string): string | undefined
  logicalOwner(sessionId: string): string
  installDurableLaneEvidence(resolve: (laneSessionId: string) => FissionLaneRecord | undefined): void
  markSilentInterrupt(ownerSessionId: string): void
  clearSilentInterrupt(ownerSessionId: string): void
  isSilentInterrupt(ownerSessionId: string): boolean
  tryConsumeSilentInterrupt(ownerSessionId: string): boolean
  trackGroupResource(groupId: string, resource: unknown): void
  disposeGroupResources(groupId: string): void
  isGroupClosed(groupId: string): boolean
  tryBeginDelivery(groupId: string, completionId: string, laneIndex: number): boolean
  endDelivery(groupId: string, completionId: string, laneIndex: number): void
  hasDeliveryClaim(groupId: string, completionId: string, laneIndex: number): boolean
  tryBeginTakeover(groupId: string): boolean
  endTakeover(groupId: string): void
  hasTakeoverClaim(groupId: string): boolean
  clearOwner(ownerSessionId: string): FissionOwnerCleanupResult
  clearAll(): void
}

export declare const fissionRuntime: FissionRuntime

export declare class FissionAdmissionRegistry {
  constructor()
  reserve(ownerSessionId: string): boolean
  isActive(ownerSessionId: string): boolean
  release(ownerSessionId: string): void
  clear(): void
  snapshot(): readonly string[]
}

export declare const fissionAdmissionRegistry: FissionAdmissionRegistry

export interface FissionHistoryTakeover {
  readonly laneIndex: number
  readonly session: string
  readonly prompt: string | null
  readonly physical: string | null
  readonly reference: string
  readonly digest: string
}
export type FissionHistoryTerminal =
  | {readonly kind:'Open'}
  | {readonly kind:'Failed',readonly reason:string}
  | {readonly kind:'Converged',readonly session:string,readonly run:string,readonly reference:string,readonly digest:string}
export interface FissionHistoryGroup {
  readonly id: string
  readonly owner: string
  readonly parent: string | null
  readonly origin: string
  readonly count: number
  readonly sessions: readonly (readonly [number,string])[]
  readonly prompts: readonly (readonly [number,string])[]
  readonly ownerReference: string
  readonly ownerDigest: string
  readonly before: readonly string[]
  readonly work: readonly (readonly [number,readonly [string,string]])[]
  readonly runs: readonly (readonly [number,string])[]
  readonly captured: readonly (readonly [string,readonly [string,string]])[]
  readonly delivered: readonly (readonly [string,readonly number[]])[]
  readonly affinities: readonly (readonly [string,number])[]
  readonly takeover: FissionHistoryTakeover | null
  readonly terminal: FissionHistoryTerminal
}
export type FissionHistoryEvent = {readonly groupId:string,readonly owner:string} & (
  | {readonly kind:'admitted',readonly parent:string|null,readonly origin:string,readonly count:number,readonly sessions:readonly string[],readonly prompts:readonly string[],readonly reference:string,readonly digest:string,readonly before:readonly string[]}
  | {readonly kind:'laneMaterialized',readonly laneIndex:number,readonly session:string,readonly run:string,readonly reference:string,readonly digest:string}
  | {readonly kind:'completionCaptured',readonly completion:string,readonly reference:string,readonly digest:string}
  | {readonly kind:'completionDelivered',readonly completion:string,readonly laneIndex:number}
  | {readonly kind:'externalAffinityBound',readonly external:string,readonly laneIndex:number}
  | {readonly kind:'takeover',readonly laneIndex:number,readonly session:string,readonly prompt:string|null,readonly physical:string|null,readonly reference:string,readonly digest:string}
  | {readonly kind:'converged',readonly session:string,readonly run:string,readonly reference:string,readonly digest:string}
  | {readonly kind:'failed',readonly reason:string}
)
export class FissionHistory {
  constructor()
  apply(event:FissionHistoryEvent): {readonly ok:true,readonly history:FissionHistory} | {readonly ok:false,readonly rejection:FissionGroupRejection}
  group(id:string): FissionHistoryGroup | null
  activeForOwner(owner:string): FissionHistoryGroup | null
  latestForOwner(owner:string): FissionHistoryGroup | null
  ownerOfLane(session:string): string | null
  membership(session:string): {readonly group:FissionHistoryGroup,readonly laneIndex:number} | null
  activeGroups(): readonly FissionHistoryGroup[]
  convergenceReady(id:string): boolean
}

export type FissionResult<T> = {readonly ok:true,readonly value:T} | {readonly ok:false,readonly error:string}
export interface FissionLaneInput {readonly index:number,readonly prompt:string}
export interface FissionStartedLane extends FissionLaneInput {readonly session:string}
export interface FissionAdmissionRequest {readonly owner:string,readonly count:number,readonly lanes:readonly FissionLaneInput[]}
export interface FissionAdmissionValue {readonly owner:string,readonly parent:string|null,readonly ownerView:string|null,readonly lanes:readonly FissionStartedLane[]}
export interface FissionAdmissionEffects {
  parentOf(owner:string):Promise<FissionResult<string|null>>
  ownerView(owner:string):Promise<FissionResult<string|null>>
  createLane(owner:string,parent:string|null,lane:FissionLaneInput):Promise<FissionResult<string>>
  renderStartup(count:number,lane:FissionStartedLane,ownerView:string|null):string
  startLane(session:string,prompt:string):Promise<FissionResult<void>>
  abortLane(session:string):Promise<void>
  interruptOwner(owner:string):Promise<FissionResult<void>>
  onLanesCreated(owner:string,parent:string|null,ownerView:string,lanes:readonly FissionStartedLane[]):Promise<FissionResult<void>>
  onFailed(owner:string,reason:string):Promise<void>
}
export interface FissionBlob {readonly reference:string,readonly digest:string}
export interface FissionConvergenceEffects<Authority> {
  history():FissionHistory
  append(event:FissionHistoryEvent):Promise<FissionResult<void>>
  readBlob(reference:string,digest:string):Promise<FissionResult<string>>
  writeBlob(text:string):Promise<FissionResult<FissionBlob>>
  ownerAuthority(owner:string):Authority|null
  retireCompletion(owner:string,completion:string):Promise<boolean>
  sendTakeover(session:string,authority:Authority,aggregate:string):Promise<FissionResult<string>>
  report(kind:string,group:FissionHistoryGroup,detail:unknown):void
}
export interface FissionObservation {
  readonly session:string
  readonly run:string
  readonly outcome:'OngoingExecution'|'NeedsContinuation'|'ProviderFailed'|'DegenerationInterrupted'|'ExternalAbort'|'Completed'
  readonly reason?:string
  readonly canNudge:boolean
}
export interface FissionObservationEffects<Authority,Observation extends FissionObservation> extends FissionConvergenceEffects<Authority> {
  abortSession(session:string):Promise<FissionResult<void>>
  notifyFailed(owner:string,reason:string):boolean
  publishOwner(group:FissionHistoryGroup,observation:Observation):Promise<FissionResult<boolean>>
  readDelivery(observation:Observation):string|null
  isExternalRetired(owner:string,external:string):boolean
  nudge(group:FissionHistoryGroup,lane:number,observation:Observation,outstanding:boolean):Promise<{readonly kind:'failed',readonly error:string}|{readonly kind:'kept'}>
}
export interface FissionBroadcast {
  readonly id:string
  readonly owner:string
  readonly lanes:readonly FissionStartedLane[]
  readonly completion:string
  readonly payload:string
}
export interface FissionBroadcastEffects<Revision> {
  history():FissionHistory
  append(event:FissionHistoryEvent):Promise<FissionResult<void>>
  writeBlob(text:string):Promise<FissionResult<FissionBlob>>
  sendShared(request:FissionBroadcast,lane:FissionStartedLane):Promise<FissionResult<boolean>>
  readonly canConverge:boolean
  revision():Revision
  awaitChange(revision:Revision):Promise<void>
  converge(owner:string):Promise<boolean>
  report(kind:string,request:FissionBroadcast,detail:unknown):void
}
export class FissionLifecycle {
  constructor()
  isActive(owner:string):boolean
  release(owner:string):void
  admit(request:FissionAdmissionRequest,effects:FissionAdmissionEffects):Promise<{readonly ok:true,readonly value:FissionAdmissionValue}|{readonly ok:false,readonly kind:'TooFewLanes'|'InvalidOrigin'|'AlreadyFissioned'|'RuntimeUnavailable',readonly error:string}>
  converge<Authority>(owner:string,effects:FissionConvergenceEffects<Authority>):Promise<boolean>
  observe<Authority,Observation extends FissionObservation>(observation:Observation,effects:FissionObservationEffects<Authority,Observation>):Promise<boolean>
  fail<Authority,Observation extends FissionObservation>(group:FissionHistoryGroup,reason:string,effects:FissionObservationEffects<Authority,Observation>):Promise<void>
  broadcast<Revision>(request:FissionBroadcast,effects:FissionBroadcastEffects<Revision>):Promise<void>
}
