import { KWayMerge, type ConvergenceResult } from 'wanxiangli/convergence'
import type { EventInput } from 'wanxiangli/events'
import { WriterRetention } from 'wanxiangli/retention'

const kept: { id: string; lastActivityMs: number }[] = new WriterRetention().retain(0, [{ id: 'w', lastActivityMs: 0 }])
void kept

const event: EventInput = { id: 'a', stream: 's', type: 't', parents: [], payload: {}, payloadRefs: [] }
const result: ConvergenceResult = new KWayMerge().merge([['writer', [event]]])
if (result.ok) {
  const first: EventInput | undefined = result.events[0]
  void first
} else {
  const code: string = result.error.code
  void code
}
