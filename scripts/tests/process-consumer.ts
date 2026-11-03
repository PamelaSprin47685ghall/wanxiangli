import { ProcessSession, runProcess, type ProcessRunRequest, type ProcessRunResult, type ProcessOptions, type OutputSlice, type OutputReceiver } from 'wanxiangli/runtime'

declare const options: ProcessOptions
const run = new ProcessSession(options)
const receive: OutputReceiver = (channel, bytes) => {
  const source: 'stdout' | 'stderr' = channel
  const raw: Uint8Array = bytes
  void source
  void raw
}
new ProcessSession(options, receive)
const slice: OutputSlice = run.read('stdout', 0)
const raw: Uint8Array = slice.bytes
const text: string | null = slice.text
const result = await run.started()
if (result.kind === 'Started') {
  const pid: number = result.pid
  await run.write(new Uint8Array([65]))
  run.endInput()
  void pid
}
const waited = await run.wait(1000)
const phase: 'Starting' | 'Running' | 'Draining' | 'Closed' = waited.state.phase
void raw
void text
void phase

// @ts-expect-error 缺预算不表示无限预算。
new ProcessSession({ executable: '/bin/true', args: [], cwd: '/tmp', env: {} })
// @ts-expect-error 文本必须显式编码为字节。
run.write('text')
// @ts-expect-error 不提供假定具有全局顺序的合并流。
run.read('combined', 0)
// @ts-expect-error 任意字符串不构成支持的 POSIX 信号。
run.signal('retry')
// @ts-expect-error 原生句柄不属于公开能力。
run.child.kill()

const request: ProcessRunRequest = {
  command: { fileName: '/bin/echo', args: ['text'], env: { KEY: 'value' }, stdin: null },
  estimate: { runtimeSeconds: 5, outputBytes: 1024n, memory: 'medium' },
  context: { hardLimitMs: 3600000, spoolDirectory: '/tmp' },
}
const completed: ProcessRunResult = await runProcess(request, new AbortController().signal)
if (completed.ok) {
  const code: number = completed.value.exitCode
  if (completed.value.kind === 'Spooled') {
    const bytes: bigint = completed.value.totalBytes
    const path: string = completed.value.spoolPath
    void bytes; void path
  } else { const text: string = completed.value.stdout; void text }
  void code
} else if (completed.error.kind === 'TimeoutExceeded') {
  const elapsed: number = completed.error.durationMs
  void elapsed
} else { const reason: string = completed.error.reason; void reason }
// @ts-expect-error 只接受已有精确字节估计，不经 number 截断。
await runProcess({ ...request, estimate: { ...request.estimate, outputBytes: 1024 } })
// @ts-expect-error 运行协调不接收宿主的可变 ChildProcess/launcher。
await runProcess(request, { spawn() {} })
