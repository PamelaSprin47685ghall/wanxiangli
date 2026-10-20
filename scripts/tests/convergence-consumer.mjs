import { KWayMerge } from 'wanxiangli/convergence'
import { WriterRetention } from 'wanxiangli/retention'

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
process.stdout.write(JSON.stringify({
  kept: kept.map(item => item.id),
  fork: fork.ok ? fork.events.map(item => item.id[0]) : fork.error,
  duplicate: duplicate.ok ? 'accepted' : duplicate.error.code,
  retained: retained.ok ? retained.events.length : retained.error.code,
}))
