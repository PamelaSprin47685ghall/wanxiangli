import { KWayMerge } from 'wanxiangli/convergence'
import { WriterRetention } from 'wanxiangli/retention'
import { CanonicalEventCodec } from 'wanxiangli/events'
import { WriterSegments } from 'wanxiangli/segments'
import { CasebookIndexLaw } from 'wanxiangli/casebook'
import { CasebookMaintenanceLaw } from 'wanxiangli/casebook-maintenance'
import { CasebookAccessLaw } from 'wanxiangli/casebook-access'

const event = (id, parents = []) => ({ id, stream: 'job/main', type: 'JobRequested', parents, payload: {}, payloadRefs: [] })
const root = event('a'.repeat(40))
const left = event('b'.repeat(40), [root.id])
const right = event('c'.repeat(40), [root.id])
const merger = new KWayMerge()
const fork = merger.merge([['writer-left', [root, left]], ['writer-right', [root, right]]])
const duplicate = merger.merge([['writer-1', [root, left]], ['writer-1', [root, right]]])
const retained = merger.mergeRetained([['writer-1', [left]]])
const now = Date.UTC(2026, 9, 20, 12)
const day = 86400000
const kept = new WriterRetention().retain(now, [{ id: 'today', lastActivityMs: now }, { id: 'old', lastActivityMs: now - 3 * day }])
const tail = [JSON.stringify({ event_type: 'ProjectionCutTail' }), JSON.stringify({ event_type: 'JournalEnvelope', payload: { ObservedAt: new Date(now).toISOString() } })]
const orphan = { ...root, payloads: { ['0'.repeat(64)]: new Uint8Array([1]) } }
const segments = new WriterSegments()
const codec = new CanonicalEventCodec()
const lineOf = item => new TextEncoder().encode(codec.encode(item))
process.stdout.write(JSON.stringify({
  groups: segments.groupWriterFiles(['w-0001.ndjson', 'w-0000.ndjson', 'w.ndjson', 'x-٠٠٠٠.ndjson']).map(group => segments.streamLayout(group).kind),
  coexistence: [segments.coexistence(lineOf(left), lineOf(root)), segments.coexistence(lineOf(root), lineOf(root))],
  stream: segments.decodeStream('w', codec.encode(root) + codec.encode(left)).events.length,
  shelfmark: new CasebookIndexLaw().shelfmarkFor('private-session-a', '## Restart behavior\nfull canonical question').startsWith('Restart behavior · '),
  maintenance: new CasebookMaintenanceLaw().summarize([new CasebookMaintenanceLaw().fileDiff('a.txt', 'old\n', 'new\n')]).refresh,
  access: new CasebookAccessLaw().relatedPaths(['b', 'a', 'b']),
  activity: new WriterRetention().lastActivity(tail) === now,
  closure: new CanonicalEventCodec().checkClosure([orphan], () => true).error.code,
  kept: kept.map(item => item.id),
  fork: fork.ok ? fork.events.map(item => item.id[0]) : fork.error,
  duplicate: duplicate.ok ? 'accepted' : duplicate.error.code,
  retained: retained.ok ? retained.events.length : retained.error.code,
}))
