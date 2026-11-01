import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { SegmentedWriter, WriterSegments } from 'wanxiangli/segments'

const segments = new WriterSegments()
assert.equal(segments.segmentFileName('consumer', 0), 'consumer-0000.ndjson')
assert.deepEqual(segments.groupWriterFiles(['consumer-0001.ndjson', 'consumer-0000.ndjson']), [
  { writerId: 'consumer', fileNames: ['consumer-0000.ndjson', 'consumer-0001.ndjson'] },
])

const root = fs.mkdtempSync(path.join(tmpdir(), 'wanxiangli-segmented-writer-consumer-'))
try {
  const directory = path.join(root, 'caller-events')
  let directoryCalls = 0
  const writer = new SegmentedWriter({ directory: () => { directoryCalls++; return directory }, writerId: 'consumer', segmentCap: 4 })
  assert.equal(directoryCalls, 0)
  assert.equal(writer.writerId, 'consumer')
  assert.deepEqual(writer.append(''), { ok: true, completion: 'no-append' })
  assert.equal(directoryCalls, 0)
  assert.equal(fs.existsSync(directory), false)
  assert.deepEqual(writer.append('α\n'), { ok: true, completion: 'durable' })
  const first = path.join(directory, 'consumer-0000.ndjson')
  assert.equal(writer.filePath(), first)
  assert.deepEqual(fs.readFileSync(first), Buffer.from('α\n'))
  assert.deepEqual(writer.append('z\n'), { ok: true, completion: 'durable' })
  const second = path.join(directory, 'consumer-0001.ndjson')
  assert.equal(writer.filePath(), second)
  assert.deepEqual(fs.readFileSync(second), Buffer.from('z\n'))
  assert.deepEqual(fs.readFileSync(first), Buffer.from('α\n'))
  assert.ok(directoryCalls > 0)
} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log('segments consumer passed')
