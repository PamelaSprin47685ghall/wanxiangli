import { KWayMerge, type ConvergenceResult } from 'wanxiangli/convergence'
import { CanonicalEventCodec, type ClosureResult, type EventInput } from 'wanxiangli/events'
import { WriterRetention } from 'wanxiangli/retention'
import { WriterSegments, type StreamLayout, type WriterFiles } from 'wanxiangli/segments'

const groups: WriterFiles[] = new WriterSegments().groupWriterFiles(['w-0000.ndjson'])
const layout: StreamLayout = new WriterSegments().streamLayout(groups[0]!)
const legacyName: string | undefined = layout.kind === 'coexisting' ? layout.legacy : undefined
void legacyName

const kept: { id: string; lastActivityMs: number }[] = new WriterRetention().retain(0, [{ id: 'w', lastActivityMs: 0 }])
void kept
const activity: number | null = new WriterRetention().lastActivity(['{}'])
void activity
const tail = new WriterRetention().classifyTail('{}')
const observed: number | undefined = tail.kind === 'observed' ? tail.observedAtMs : undefined
void observed

const event: EventInput = { id: 'a', stream: 's', type: 't', parents: [], payload: {}, payloadRefs: [] }
const result: ConvergenceResult = new KWayMerge().merge([['writer', [event]]])
if (result.ok) {
  const first: EventInput | undefined = result.events[0]
  void first
} else {
  const code: string = result.error.code
  void code
}
const closure: ClosureResult = new CanonicalEventCodec().checkClosure([event], () => true)
if (!closure.ok) {
  const closureCode: string = closure.error.code
  void closureCode
}
