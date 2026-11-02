import { TaskScope, type DrainResult } from 'wanxiangli/task-scope'

const scope = new TaskScope()
const foreground: Promise<void> = scope.run(async () => {})
const background: Promise<void> = scope.background(async () => {})
const idle: Promise<DrainResult> = scope.waitIdle()
const closed: Promise<DrainResult> = scope.close()
void foreground; void background; void closed
void idle.then(result => {
  if (!result.ok) {
    const cause: unknown = result.error
    return cause
  }
})
// @ts-expect-error 工作必须返回 Promise<void>。
scope.run(() => 42)
// @ts-expect-error 任务不能省略回调。
scope.background()
// @ts-expect-error 不公开配对 start/finish 或可改计数。
scope.finish()
// @ts-expect-error 关闭没有 timeout/cancel 策略矩阵。
scope.close({ timeoutMs: 1 })
