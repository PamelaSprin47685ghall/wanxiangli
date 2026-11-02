export interface FileLockLease {
  release(): Promise<void>
}

export type LockWait =
  | { kind: 'Retry'; retries: number; minTimeoutMs: number; maxTimeoutMs: number; factor: number }
  | { kind: 'Budget'; budgetMs: number }

export interface FileLockAcquireTimeout extends Error {
  readonly name: 'FileLockAcquireTimeout'
  readonly path: string
  readonly attempts: number
  readonly waitedMs: number
}

export declare function acquire(path: string, wait: LockWait): Promise<FileLockLease>
export declare function isAcquireTimeout(cause: unknown): cause is FileLockAcquireTimeout
