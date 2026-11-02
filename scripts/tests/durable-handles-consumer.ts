import { HandleHistory, DurableHandles, type HistoryHandle, type HistoryWork, type DurableHandleEffects, type DurableHandleDelivery } from 'wanxiangli/handle-lifecycle'
const handle: HistoryHandle = { kind: 0, id: 'one' }
const work: HistoryWork = { handle, child: 'child', root: 'root' }
const history = new HandleHistory()
const effects: DurableHandleEffects = {
  current: () => history,
  refresh: () => ({ ok: true, value: undefined }),
  append: async fact => ({ ok: true, value: fact.kind }),
  writeBlob: async body => ({ ok: true, value: { reference: body, digest: body } }),
  readBlob: async reference => ({ ok: true, value: reference }),
  sha256: body => body,
  mintConsumptionId: () => 'consume',
}
const durable = new DurableHandles(effects)
void durable.complete({ work, handle, logicalRun: 'run', child: 'child', kind: 'Terminal', body: 'body' })
const result = await durable.drain(32, record => record.parentVisible)
if (result.ok) { const deliveries: DurableHandleDelivery[] = result.value; void deliveries }
