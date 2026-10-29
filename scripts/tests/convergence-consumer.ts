import { KWayMerge, type ConvergenceResult } from 'wanxiangli/convergence'
import { CanonicalEventCodec, type ClosureResult, type EventInput } from 'wanxiangli/events'
import { WriterRetention } from 'wanxiangli/retention'
import { CasebookIndexLaw, type IndexEntry } from 'wanxiangli/casebook'
import { CasebookMaintenanceLaw, type MaintenanceSummary } from 'wanxiangli/casebook-maintenance'
import { CasebookAccessLaw, type Access } from 'wanxiangli/casebook-access'
import { WriterSegments, type Coexistence, type StreamDecodeResult, type StreamLayout, type WriterFiles } from 'wanxiangli/segments'

const groups: WriterFiles[] = new WriterSegments().groupWriterFiles(['w-0000.ndjson'])
const layout: StreamLayout = new WriterSegments().streamLayout(groups[0]!)
const legacyName: string | undefined = layout.kind === 'coexisting' ? layout.legacy : undefined
void legacyName
const verdict: Coexistence = new WriterSegments().coexistence(new Uint8Array(), new Uint8Array())
const copied: number | undefined = verdict.kind === 'continuation' ? verdict.copiedLines : undefined
void copied
const stream: StreamDecodeResult = new WriterSegments().decodeStream('w', '')
const streamCount: number = stream.ok ? stream.events.length : -1
void streamCount

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

const entries: IndexEntry[] = new CasebookIndexLaw().entries([{ sessionId: 's', question: 'q' }])
const victims: string[] = new CasebookIndexLaw().evictionVictims(1, [{ sessionId: 's', accessOrder: 1n }])
void entries
void victims

const maintenance: MaintenanceSummary = new CasebookMaintenanceLaw().summarize([new CasebookMaintenanceLaw().fileDiff('a.txt', null, 'x')])
const readVerdict: 'missing' | 'fault' = new CasebookMaintenanceLaw().readFailure('ENOENT')
void maintenance
void readVerdict
const access: Access = { kind: 'move', source: 'a', destination: 'b' }
const accessed: string[] = new CasebookAccessLaw().accessPaths(access)
const execRead: string | null = new CasebookAccessLaw().execRead('cat a')
void accessed
void execRead
