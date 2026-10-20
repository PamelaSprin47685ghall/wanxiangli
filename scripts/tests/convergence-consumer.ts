import { KWayMerge, type ConvergenceResult } from 'wanxiangli/convergence'
import type { EventInput } from 'wanxiangli/events'

const event: EventInput = { id: 'a', stream: 's', type: 't', parents: [], payload: {}, payloadRefs: [] }
const result: ConvergenceResult = new KWayMerge().merge([['writer', [event]]])
if (result.ok) {
  const first: EventInput | undefined = result.events[0]
  void first
} else {
  const code: string = result.error.code
  void code
}
