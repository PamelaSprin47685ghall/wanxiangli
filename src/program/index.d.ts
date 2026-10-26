export * from './wait/types.js'
import type { CallResult, OutputSnapshot, RuntimeFailure } from 'wanxiangli/runtime'

export interface RoleSurface { readonly toolName: string; readonly capabilities: string[]; readonly members: string[] }
export interface ProgramCatalogMessages {
  projectPermission(label: unknown): string | null
  projectPermissions(labels: unknown): string[]
  admitsSurface(labels: unknown): boolean
  toolNameFor(role: unknown): string
  membersFor(jsCapabilities: unknown, roleName: unknown): string[]
  projectRole(role: unknown, officePermissions: unknown): RoleSurface | null
}
export function ProgramCatalog(): ProgramCatalogMessages

export type ProgramState = 'running' | 'draining' | 'waiting' | 'parked' | 'settling' | 'abandoning' | 'completed' | 'failed' | 'abandoned'
export interface CommandObservation {
  readonly started: boolean
  readonly running: boolean
  readonly pid: number | null
  readonly result: CallResult | RuntimeFailure | null
}
export interface ProgramObservation {
  readonly name: string
  readonly state: ProgramState
  readonly reason?: string
  readonly payload?: unknown
  readonly command?: CommandObservation
  readonly pendingOperations?: number
  readonly source?: string
  readonly remainingWaitMs?: number
  readonly delta?: OutputSnapshot | Record<string, never>
  readonly lifecycleError?: RuntimeFailure
  readonly forced?: boolean
  readonly code?: string
  readonly value?: unknown
}
export type ProgramReceipt =
  | (ProgramObservation & { readonly state: 'completed'; readonly value: unknown })
  | (ProgramObservation & { readonly state: 'failed'; readonly code: string; readonly reason: string })
  | (ProgramObservation & { readonly state: 'parked'; readonly reason: 'sdk-drain' | 'call' | 'explicit' | 'yield' | 'control'; readonly payload: unknown })
  | (ProgramObservation & { readonly state: 'abandoned'; readonly forced: boolean })
  | (ProgramObservation & { readonly state: 'abandoning' | 'running' | 'waiting' | 'draining' | 'settling' })
export interface ProgramOptions {
  readonly name: string
  readonly program: string
  readonly intent: string
  readonly callId?: string
  readonly baseClass: string
  readonly capabilities: readonly string[]
  readonly api: Readonly<Record<string, unknown>>
  readonly syncMembers?: readonly string[]
  readonly root: string
  readonly outputRoot?: string
  readonly executionBudgetMs: number
  readonly outputBoundBytes: number
  readonly settle?: (receipt: ProgramReceipt) => ProgramReceipt | void | Promise<ProgramReceipt | void>
  readonly lifecycle?: (event: ProgramObservation & { readonly event: string }) => unknown
}
export interface ProgramSessionInstance {
  execute(options: ProgramOptions): Promise<ProgramReceipt>
  inspect(): ProgramObservation[]
  pendingNames(): string[]
  close(): Promise<SessionCloseReceipt>
}
export interface SessionCloseReceipt {
  readonly sessionId: string
  readonly state: 'closed' | 'closing'
  readonly programs: ProgramReceipt[]
}
export interface ProgramSessions {
  session(sessionId: string): ProgramSessionInstance
  close(sessionId: string): Promise<SessionCloseReceipt>
  inspect(): { readonly sessionId: string; readonly programs: ProgramObservation[] }[]
}
export function ProgramSession(sessionId: string): ProgramSessionInstance
export function Program(): ProgramSessions

export declare class ProgramCallers {
  constructor()
  noteCaller(sessionId: string, callId: string, name: string): void
  clearCaller(sessionId: string, callId: string): void
  callerName(sessionId: string, callId: string): string | undefined
  clearSession(sessionId: string): void
  clearAll(): void
  readonly count: number
  inspect(): { readonly count: number; readonly keys: string[] }
}
export declare const programCallers: ProgramCallers
