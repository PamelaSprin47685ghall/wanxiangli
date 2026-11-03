import { mapBounded } from 'wanxiangli/bounded-map'

const source: readonly number[] = [1, 2]
const controller = new AbortController()
const strings: Promise<string[]> = mapBounded(2, async (item, signal) => {
  const cancellation: AbortSignal = signal
  cancellation.throwIfAborted()
  return String(item)
}, source, controller.signal)
const numbers: Promise<number[]> = mapBounded(1, async item => item + 1, source)
void strings
void numbers
// @ts-expect-error 输入项与回调参数必须一致。
mapBounded(1, async (item: string) => item, source)
// @ts-expect-error 取消参数是原生 AbortSignal。
mapBounded(1, async item => item, source, { cancelled: false })
// @ts-expect-error 限额必须是数值。
mapBounded('2', async item => item, source)
