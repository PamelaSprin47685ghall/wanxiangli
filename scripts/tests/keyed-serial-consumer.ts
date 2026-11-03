import { KeyedSerial } from 'wanxiangli/keyed-serial'

const queue = new KeyedSerial()
const object: Promise<{ answer: number }> = queue.run('session', async () => ({ answer: 42 }))
const text: Promise<string> = queue.run('session', async () => 'done')
const nothing: Promise<void> = queue.run('session', async () => {})
void object
void text
void nothing
// @ts-expect-error key 是不透明字符串。
queue.run(42, async () => 'done')
// @ts-expect-error action 返回 Promise。
queue.run('session', () => 'done')
// @ts-expect-error 不新增取消或重置入口。
queue.reset('session')
// @ts-expect-error 私有尾表不可访问。
queue.tails.clear()
