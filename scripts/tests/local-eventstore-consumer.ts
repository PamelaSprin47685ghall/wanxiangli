import {
  LocalEventStore, LocalIntegrator, readLocalStreams, localWriterMetadata,
  localInventory, convergeLocalWriter, acquireLocalLock, createLocalWriter,
  appendLocalEvents, localPayloadDigest,
} from 'wanxiangli/local-eventstore'
import type { IntegrationRule, AppendPhase, LocalLock } from 'wanxiangli/local-eventstore'
import type { EventInput, EventOutput, CodecError } from 'wanxiangli/events'

const rule: IntegrationRule = {
  name: 'count', initial: 0, accepts: () => true, faultScope: () => 'one',
  integrate: current => ({ ok: true, value: Number(current) + 1 }),
  planCut: () => ({ ok: true, value: { resetJson: '{}' } }),
  applyCut: current => ({ ok: true, value: current }),
}
const integrator = new LocalIntegrator({ rules: [rule], isKnownEventType: () => true })
const directory = () => '/caller/events'
const store = new LocalEventStore({
  directory, lockTarget: () => '/caller/owner', writerId: 'consumer',
  segmentCap: 67108864, integrator,
})
const event: EventInput = { id: 'a', stream: 'work', type: 'Add', parents: [], payload: {}, payloadRefs: [] }
const appended = await store.append([event])
if (!appended.ok && appended.error.kind === 'CommitUnknown') {
  const phase: AppendPhase = appended.error.primary.phase
  const original: unknown = appended.error.primary.cause
  void phase; void original
}
const payload = await store.writePayload(new Uint8Array([65]))
if (payload.ok) await store.readPayload(payload.value)
const current: unknown | null = store.current('count')
const loadedEvent: EventOutput | null = store.event('a')
const heads: string[] = store.heads('work')
const head: string | null = store.head('work')
void current; void loadedEvent; void heads; void head
store.allHeads(); store.reload()

const streams = readLocalStreams(directory, Date.now())
if (streams.ok) {
  const entries: EventOutput[] = streams.streams.flatMap(stream => stream.events)
  void entries
} else {
  const error: CodecError = streams.error
  void error
}
const metadata = localWriterMetadata(directory)
const inventory: string = localInventory(directory)
const reorganized = convergeLocalWriter(directory, 'consumer', 1024)
if (!reorganized.ok) {
  const reason: string = reorganized.reason
  void reason
}
const lock: LocalLock = await acquireLocalLock(() => '/caller/owner')
await lock.release()
const writer = createLocalWriter({ directory, writerId: 'consumer', segmentCap: 1024 })
const written = appendLocalEvents(writer, [event])
if (!written.ok) {
  const original: unknown = written.primary.cause
  void original
}
const digest: string = localPayloadDigest(new Uint8Array([65]))
void metadata; void inventory; void digest
