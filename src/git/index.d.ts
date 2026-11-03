export interface PorcelainWorktreeEntry {
  readonly path: string
  /** Full ref reported by Git; null when detached or bare. */
  readonly branch: string | null
}
export type PrimaryWorktree =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly code: 'bare' | 'unidentified' }
export interface GitPathProbe {
  readonly code: number
  readonly path: string
}
export interface GitPorcelainMessages {
  worktrees(output: string): readonly PorcelainWorktreeEntry[]
  primaryWorktree(outputZ: string): PrimaryWorktree
  branches(output: string): readonly string[]
  shortBranch(reference: string): string
  rebaseStatePaths(merge: GitPathProbe, apply: GitPathProbe): readonly string[]
}
/** Pure parsers; they run no commands and inspect no files. */
export declare function GitPorcelain(): GitPorcelainMessages

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
export type WorktreeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }
export interface WorktreeEntry {
  readonly path: string
  /** Git 报告的完整分支 ref；detached 为 null。 */
  readonly identity: string | null
}
export interface WorktreeResource {
  readonly path: string
  readonly identity: string
  markDurable(): void
  release(): Promise<WorktreeResult<void>>
  dispose(): Promise<void>
}
export declare class GitWorktrees {
  constructor(repo: string, run: Runner)
  create(identity: string, path: string, sourceRef: string): Promise<WorktreeResult<WorktreeResource>>
  adopt(identity: string, path: string): WorktreeResource
  remove(path: string): Promise<WorktreeResult<void>>
  list(): Promise<WorktreeResult<WorktreeEntry[]>>
  listBranches(pattern: string): Promise<WorktreeResult<string[]>>
  deleteBranch(identity: string): Promise<WorktreeResult<void>>
}

export type PublicationResult<T> =
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
  dirtyPaths(worktree: string): Promise<PublicationResult<string[]>>
  currentBranch(): Promise<PublicationResult<string>>
  readHead(worktree: string): Promise<PublicationResult<string>>
  targetHead(target: string): Promise<PublicationResult<string>>
  rebaseInProgress(worktree: string): Promise<boolean>
  rebase(worktree: string, target: string): Promise<PublicationResult<void>>
  conflictedPaths(worktree: string): Promise<PublicationResult<string[]>>
  prepare(worktree: string, commitMessage: string): Promise<PublicationResult<void>>
  fastForward(request: FastForwardRequest): Promise<PublicationResult<string>>
}
