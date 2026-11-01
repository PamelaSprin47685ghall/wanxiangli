import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CanonicalEventCodec } from 'wanxiangli/events'
import {
  LocalEventStore, LocalIntegrator, readLocalStreams, localWriterMetadata,
  localInventory, convergeLocalWriter, acquireLocalLock, createLocalWriter,
  appendLocalEvents, localPayloadDigest,
} from 'wanxiangli/local-eventstore'

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'local-eventstore-consumer-')))
const event = (id, value, parents = [], payloadRefs = []) => ({
  id, stream: 'consumer', type: 'Add', parents, payload: { value }, payloadRefs,
})
const rules = [{
  name: 'sum', initial: 0,
  accepts: value => value.type === 'Add',
  faultScope: () => 'consumer',
  integrate: (current, value) => ({ ok: true, value: current + value.payload.value }),
  planCut: () => ({ ok: false, error: 'unexpected cut' }),
  applyCut: current => ({ ok: true, value: current }),
}]
const integrator = () => new LocalIntegrator({ rules, isKnownEventType: type => type === 'Add' || type === 'ProjectionCutTail' })
try {
  const directory = () => path.join(root, 'events')
  const lockTarget = () => path.join(root, 'owner')
  const options = { directory, lockTarget, segmentCap: 67108864 }
  const first = new LocalEventStore({ ...options, writerId: 'first', integrator: integrator() })
  const bytes = Buffer.from('原文\r\n\uFEFF\u0000')
  const reference = await first.writePayload(bytes)
  assert.equal(reference.ok, true)
  assert.equal(reference.value, localPayloadDigest(bytes))
  assert.deepEqual(await first.append([event('a', 2, [], [reference.value])]), { ok: true, value: { cuts: [] } })
  assert.equal(first.current('sum'), 2)
  const second = new LocalEventStore({ ...options, writerId: 'second', integrator: integrator() })
  assert.deepEqual(Buffer.from((await second.readPayload(reference.value)).value), bytes)
  assert.equal((await second.append([event('b', 3, ['a'])])).ok, true)
  assert.equal(first.reload().ok, true)
  assert.equal(first.current('sum'), 5)
  assert.deepEqual(first.heads('consumer'), ['b'])
  const read = readLocalStreams(directory, Date.now())
  assert.equal(read.ok, true)
  assert.deepEqual(read.streams.map(value => value.writerId), ['first', 'second'])
  assert.equal(localWriterMetadata(directory).length, 2)
  assert.match(localInventory(directory), /first/)
  assert.equal(fs.existsSync(lockTarget() + '.lock'), false)

  const legacyDirectory = () => path.join(root, 'legacy-events')
  fs.mkdirSync(legacyDirectory())
  const codec = new CanonicalEventCodec()
  fs.writeFileSync(path.join(legacyDirectory(), 'legacy.ndjson'), codec.encode(event('old', 1)))
  const lease = await acquireLocalLock(lockTarget)
  try {
    assert.deepEqual(convergeLocalWriter(legacyDirectory, 'legacy', 1), { ok: true })
  } finally {
    await lease.release()
  }
  const writer = createLocalWriter({ directory: legacyDirectory, writerId: 'legacy', segmentCap: 1 })
  assert.deepEqual(appendLocalEvents(writer, [event('next', 2, ['old'])]), { ok: true, completion: 'durable' })
  assert.equal(path.basename(writer.filePath()), 'legacy-0001.ndjson')
  const legacy = readLocalStreams(legacyDirectory, Date.now())
  assert.equal(legacy.ok, true)
  assert.deepEqual(legacy.streams[0].events.map(value => value.id), ['old', 'next'])
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
console.log(JSON.stringify({ localEventStore: true }))
