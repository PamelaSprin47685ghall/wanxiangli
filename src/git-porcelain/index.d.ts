/**
 * wanxiangli/git-porcelain — read-only Git physics (CUT-23 ①).
 *
 * Reads the text Git prints for `worktree list --porcelain[ -z]`, `branch --list`
 * and `rev-parse --git-path rebase-merge|rebase-apply`. Spawns nothing, touches no file:
 * the caller runs Git and hands the raw output in. Results are frozen plain JS data.
 */

export interface WorktreeEntry {
  readonly path: string
  /** Full ref as Git prints it (e.g. `refs/heads/manager/j1`); null when detached/bare. */
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
  /** `git worktree list --porcelain` (LF; a CR before LF is part of the terminator). */
  worktrees(output: string): readonly WorktreeEntry[]
  /** First record of `git worktree list --porcelain -z`. */
  primaryWorktree(outputZ: string): PrimaryWorktree
  /** `git branch --list`, with the `*` / `+` checkout markers removed. */
  branches(output: string): readonly string[]
  /** Strips a leading `refs/heads/`. */
  shortBranch(reference: string): string
  /** `manager/<job>` with or without `refs/heads/`. */
  isManagerBranch(reference: string): boolean
  /** The branch (stable worktree identity) of a manager job. */
  managerBranchOf(jobId: string): string
  /** Trimmed rebase state directories to probe; a rebase is in progress iff one exists. */
  rebaseStatePaths(merge: GitPathProbe, apply: GitPathProbe): readonly string[]
  /**
   * Worktree cleanup: paths of `worktree list` records on a manager branch whose short name no
   * active job owns. Primary and detached worktrees are never stale.
   */
  staleWorktrees(entries: readonly WorktreeEntry[], owned: readonly string[]): readonly string[]
  /** The listed manager branches whose short name no active job owns, as listed. */
  staleBranches(branches: readonly string[], owned: readonly string[]): readonly string[]
}

export declare function GitPorcelain(): GitPorcelainMessages

export declare class RuntimePathStore {
  constructor()
  normalizeKey(workspace: string): string
  has(workspace: string): boolean
  invalidate(workspace: string, expected?: unknown): boolean
  clear(): void
  getOrCompute<T = unknown>(workspace: string, compute: (normalizedKey: string) => T): T
}

export declare const runtimePathStore: RuntimePathStore
