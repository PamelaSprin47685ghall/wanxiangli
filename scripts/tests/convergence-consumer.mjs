import { KWayMerge } from 'wanxiangli/convergence'

const event = (id, parents = []) => ({ id, stream: 'job/main', type: 'JobRequested', parents, payload: {}, payloadRefs: [] })
const root = event('a'.repeat(40))
const left = event('b'.repeat(40), [root.id])
const right = event('c'.repeat(40), [root.id])
const merger = new KWayMerge()
const fork = merger.merge([['writer-left', [root, left]], ['writer-right', [root, right]]])
const duplicate = merger.merge([['writer-1', [root, left]], ['writer-1', [root, right]]])
const retained = merger.mergeRetained([['writer-1', [left]]])
process.stdout.write(JSON.stringify({
  fork: fork.ok ? fork.events.map(item => item.id[0]) : fork.error,
  duplicate: duplicate.ok ? 'accepted' : duplicate.error.code,
  retained: retained.ok ? retained.events.length : retained.error.code,
}))
