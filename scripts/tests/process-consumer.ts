import { ProcessSession, type ProcessOptions, type OutputSlice } from 'wanxiangli/runtime'

declare const options: ProcessOptions
const run = new ProcessSession(options)
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
