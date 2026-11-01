export interface Command {
  readonly cwd?: string
  readonly args: readonly string[]
}

export interface CommandOutput {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }
export type Runner = (command: Command) => Promise<CommandOutput>

export interface WorktreeEntry {
  readonly path: string
  /** Git 报告的完整分支 ref；detached 为 null。 */
  readonly identity: string | null
}

export interface WorktreeResource {
  readonly path: string
  readonly identity: string
  markDurable(): void
  release(): Promise<Result<void>>
  dispose(): Promise<void>
}

export declare class GitWorktrees {
  constructor(repo: string, run: Runner)
  create(identity: string, path: string, sourceRef: string): Promise<Result<WorktreeResource>>
  adopt(identity: string, path: string): WorktreeResource
  remove(path: string): Promise<Result<void>>
  list(): Promise<Result<WorktreeEntry[]>>
  listBranches(pattern: string): Promise<Result<string[]>>
  deleteBranch(identity: string): Promise<Result<void>>
}
