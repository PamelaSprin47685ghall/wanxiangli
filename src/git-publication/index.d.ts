export interface Command {
  readonly cwd?: string
  readonly args: readonly string[]
}
export interface CommandOutput {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}
export type Runner = (command: Command) => Promise<CommandOutput>
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: 'target-moved' | 'failed' }
export interface FastForwardRequest {
  readonly worktree: string
  readonly target: string
  readonly expectedHead: string
  readonly candidate: string
}
export declare class GitPublication {
  constructor(repo: string, run: Runner)
  dirtyPaths(worktree: string): Promise<Result<string[]>>
  currentBranch(): Promise<Result<string>>
  readHead(worktree: string): Promise<Result<string>>
  targetHead(target: string): Promise<Result<string>>
  rebaseInProgress(worktree: string): Promise<boolean>
  rebase(worktree: string, target: string): Promise<Result<void>>
  conflictedPaths(worktree: string): Promise<Result<string[]>>
  prepare(worktree: string, commitMessage: string): Promise<Result<void>>
  fastForward(request: FastForwardRequest): Promise<Result<string>>
}
