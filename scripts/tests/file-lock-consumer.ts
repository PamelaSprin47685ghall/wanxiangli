import { acquire, isAcquireTimeout, type FileLockLease, type LockWait } from 'wanxiangli/file-lock'

const retry: LockWait = { kind: 'Retry', retries: 50, minTimeoutMs: 50, maxTimeoutMs: 250, factor: 1.1 }
const budget: LockWait = { kind: 'Budget', budgetMs: 30000 }
const lease: Promise<FileLockLease> = acquire('/tmp/shared', retry)
void lease.then(value => { const released: Promise<void> = value.release(); return released })
void acquire('/tmp/shared', budget)
function diagnose(cause: unknown): number | undefined {
  if (isAcquireTimeout(cause)) {
    const error: Error = cause
    const path: string = cause.path
    const name: 'FileLockAcquireTimeout' = cause.name
    void error; void path; void name
    return cause.attempts + cause.waitedMs
  }
}
void diagnose
// @ts-expect-error 没有取消或自定义等待策略。
void acquire('/tmp/shared', { kind: 'Cancel' })
// @ts-expect-error Retry 必须完整给出参数。
void acquire('/tmp/shared', { kind: 'Retry', retries: 1 })
// @ts-expect-error 租约不公开底层释放函数或 fs。
void lease.then(value => value.fs)
