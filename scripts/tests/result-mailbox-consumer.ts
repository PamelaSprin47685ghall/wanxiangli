import { ResultMailbox, type JoinResult, type JoinStart } from 'wanxiangli/result-mailbox'

const mailbox = new ResultMailbox<{ value: number }, { input: string }>()
mailbox.start()
mailbox.publish({ value: 42 })
const active: boolean = mailbox.hasActive
const count: number = mailbox.pendingCount
const drained: { value: number }[] = mailbox.drain(8)
const join: JoinStart<{ value: number }, { input: string }> = mailbox.beginJoin(8, Promise.resolve({ input: 'message' }))
function inspect(result: JoinResult<{ value: number }, { input: string }>): string | number | undefined {
  if (result.kind === 'items') return result.items[0].value
  if (result.kind === 'interrupted') return result.reason.input
}
if (join.kind === 'ready') inspect(join.result)
else void join.completion.then(inspect)
void active; void count; void drained
// @ts-expect-error payload 保持调用方选定类型。
mailbox.publish('not a result')
// @ts-expect-error 中断原因保持调用方选定类型。
mailbox.beginJoin(8, Promise.resolve('not an input'))
// @ts-expect-error 活动数只读，由 start/publish 管理。
mailbox.hasActive = false
// @ts-expect-error 不公开内部等待者或永久取消消息。
mailbox.cancel()
