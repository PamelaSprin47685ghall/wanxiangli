export { Filesystem, type AnchorSpec, type GrepHit, type StagedMutation, type VisibleEntry, type VisibleEntriesResult, type Result as FilesystemResult } from './files/types.js'
export { ProcessSession, type ProcessOptions, type ProcessState, type OutputSlice, type StartResult, type WriteResult, type SignalResult, type SignalName as ProcessSignalName, type Failure as ProcessFailure } from './process/types.js'
export { Terminal, type TerminalOptions, type TerminalExit, type TerminalState, type PtyDriver, type OpenResult, type CloseResult as TerminalCloseResult, type ReadResult as TerminalReadResult, type SignalName as TerminalSignalName, type Failure as TerminalFailure } from './pty/types.js'
export { OutputSpool, type SpoolOptions, type SpoolState, type SpoolResult, type Channel, type AppendResult, type DiscardResult, type ReadResult as SpoolReadResult, type TailResult, type Failure as SpoolFailure } from './spool/types.js'
export { Time, type Deadline, type IDeadlineHandle, type ITimerPort, type IClockPort, type VirtualTimerPort, type VirtualClockPort } from './time/types.js'

export interface RuntimeFailure { readonly ok: false; readonly code: string; readonly reason: string }
export interface OutputBytes { readonly stdout: number; readonly stderr: number }
export interface OutputSnapshot {
  readonly stdout: string
  readonly stderr: string
  readonly bytes: OutputBytes
  readonly truncatedBytes: OutputBytes
  readonly truncated: boolean
  readonly outputFiles: { readonly stdout: string; readonly stderr: string }
}
export interface CallResult extends OutputSnapshot {
  readonly pid: number
  readonly durationMs: number
  readonly exitCode: number | null
  readonly signal: string | null
}
export interface PhysicalExit {
  readonly forced: boolean
  readonly exitCode: number | null
  readonly signal: string | null
}
export interface CommandControlReceipt {
  readonly sent: boolean
  readonly pid?: number
  readonly state?: 'exited' | 'not-started'
  readonly signal?: string
  readonly bytes?: number
}
export interface RuntimeCommand {
  readonly pid: number
  readonly result: Promise<CallResult>
  delta(): OutputSnapshot
  signal(signal: string): Promise<CommandControlReceipt>
  send(input: string): Promise<CommandControlReceipt>
  close(): Promise<PhysicalExit>
}
export type ExecutionMessage =
  | { readonly type: 'request'; readonly id: number; readonly member: string; readonly args: unknown[]; readonly blocking: boolean }
  | { readonly type: 'completed'; readonly value: unknown }
  | { readonly type: 'failed'; readonly code: string; readonly reason: string; readonly exitCode?: number | null; readonly signal?: string | null; readonly diagnostics?: string }
export type ExecutionReply = { readonly ok: true; readonly value: unknown } | RuntimeFailure
export interface ExecutionUnit {
  readonly pid: number
  readonly exited: Promise<PhysicalExit>
  reply(id: number, response: ExecutionReply): void
  pause(): void
  resume(): void
  stop(reason?: string): Promise<PhysicalExit>
}
export interface RuntimeInstance {
  now(): number
  schedule(delayMs: number, callback: () => void): { cancel(): void }
  startUnit(spec: {
    readonly program: string
    readonly baseClass: string
    readonly members: readonly string[]
    readonly syncMembers?: readonly string[]
    readonly executionBudgetMs: number
    readonly outputBoundBytes?: number
  }, onMessage: (message: ExecutionMessage) => unknown): ExecutionUnit
  startCommand(spec: {
    readonly root: string
    readonly command: string
    readonly outputRoot?: string
    readonly outputBoundBytes?: number
  }): RuntimeCommand
}
export function Runtime(): RuntimeInstance

export interface FileStat { readonly exists: boolean; readonly size: number; readonly mtime: string | null; readonly isDir: boolean }
export type FileMutation =
  | { readonly kind: 'create'; readonly path: string; readonly text: string }
  | { readonly kind: 'rewrite'; readonly path: string; readonly originalText: string; readonly newText: string }
  | { readonly kind: 'remove'; readonly path: string }
  | { readonly kind: 'move'; readonly path: string; readonly destination: string }
export interface FileSessionInstance {
  cat(path: string): { readonly ok: true; readonly text: string } | RuntimeFailure
  write(path: string, text: string): { readonly ok: true } | RuntimeFailure
  rm(path: string): { readonly ok: true; readonly removed: string } | RuntimeFailure
  mv(path: string, destination: string): { readonly ok: true; readonly moved: string; readonly destination: string } | RuntimeFailure
  mkdir(path: string): { readonly ok: true } | RuntimeFailure
  stat(path: string): { readonly ok: true; readonly stat: FileStat } | RuntimeFailure
  ls(path?: string): { readonly ok: true; readonly entries: string[] } | RuntimeFailure
}
export function FileSession(spec: {
  readonly root: string
  readonly before?: (mutation: FileMutation) => unknown
  readonly after?: (mutation: FileMutation, token: unknown) => void
  readonly read?: (canonicalPath: string, text: string) => void
}): FileSessionInstance

export type TextSpan = [number, number]
export interface AnchorPause {
  readonly __programPark: {
    readonly needle: string
    readonly candidates: readonly unknown[]
    readonly nearest: unknown
  }
}
export interface RuntimeToolsInstance {
  whereAll(content: string, needle: string, from?: number): { readonly ok: true; readonly spans: TextSpan[] } | RuntimeFailure
  where(content: string, needle: string, from?: number, stack?: unknown): { readonly ok: true; readonly span: TextSpan } | RuntimeFailure | AnchorPause
  rg(args: readonly string[]): Promise<unknown>
}
export function RuntimeTools(root: string): RuntimeToolsInstance
