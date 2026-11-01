import { GitWorktrees, type Command, type Result, type WorktreeResource } from 'wanxiangli/git-worktrees'

const service = new GitWorktrees('/repo', async (command: Command) => {
  const cwd: string | undefined = command.cwd
  const args: readonly string[] = command.args
  void cwd; void args
  return { code: 0, stdout: '', stderr: '' }
})
const created: Promise<Result<WorktreeResource>> = service.create('branch/name', '/worktree', 'HEAD')
const resource = service.adopt('renamed/branch', '/worktree')
const path: string = resource.path
const identity: string = resource.identity
resource.markDurable()
const released: Promise<Result<void>> = resource.release()
const disposed: Promise<void> = resource.dispose()
void created; void path; void identity; void released; void disposed
void service.list().then(result => { if (result.ok) { const branch: string | null = result.value[0].identity; return branch } return result.error })
void service.listBranches('custom/*')
// @ts-expect-error 资源身份不能从外部改写。
resource.identity = 'other'
// @ts-expect-error 工作树创建由宿主显式给出身份、路径和来源。
void service.create('/worktree')
// @ts-expect-error 运行器不能交回不含 code/stdout/stderr 的结果。
void new GitWorktrees('/repo', async () => ({ code: 0 }))
// @ts-expect-error 没有资源取消或通用执行方法。
resource.cancel()
