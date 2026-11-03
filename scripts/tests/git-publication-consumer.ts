import { GitPublication, type Command, type Runner, type PublicationResult as Result, type FastForwardRequest } from 'wanxiangli/git'

const runner: Runner = async (command: Command) => {
  const cwd: string | undefined = command.cwd
  const args: readonly string[] = command.args
  void cwd; void args
  return { code: 0, stdout: '', stderr: '' }
}
const service = new GitPublication('/repo', runner)
const dirty: Promise<Result<string[]>> = service.dirtyPaths('/candidate')
const branch: Promise<Result<string>> = service.currentBranch()
const head: Promise<Result<string>> = service.readHead('/candidate')
const target: Promise<Result<string>> = service.targetHead('main')
const inProgress: Promise<boolean> = service.rebaseInProgress('/candidate')
const rebased: Promise<Result<void>> = service.rebase('/candidate', 'main')
const conflicts: Promise<Result<string[]>> = service.conflictedPaths('/candidate')
const prepared: Promise<Result<void>> = service.prepare('/candidate', 'caller message')
const request: FastForwardRequest = { worktree: '/candidate', target: 'main', expectedHead: 'base', candidate: 'pin' }
const published: Promise<Result<string>> = service.fastForward(request)
void published.then(result => {
  if (result.ok) { const sha: string = result.value; return sha }
  const code: 'target-moved' | 'failed' = result.code
  const error: string = result.error
  void code; return error
})
void dirty; void branch; void head; void target; void inProgress; void rebased; void conflicts; void prepared
// @ts-expect-error 发布必须给出固定候选。
void service.fastForward({ worktree: '/candidate', target: 'main', expectedHead: 'base' })
// @ts-expect-error 提交文案由调用方显式提供。
void service.prepare('/candidate')
// @ts-expect-error 不向调用方暴露独立 stage helper。
void service.stageAll('/candidate')
// @ts-expect-error 运行结果必须含 stdout 与 stderr。
void new GitPublication('/repo', async () => ({ code: 0 }))
