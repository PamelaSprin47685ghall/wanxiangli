import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { FileBaseline } from 'wanxiangli/file-baseline'

const directory = fs.mkdtempSync(path.join(tmpdir(), 'wanxiangli-file-baseline-consumer-'))
try {
  const stored = new Map()
  const payloads = {
    async read(reference) { return { ok: true, value: stored.has(reference) ? Uint8Array.from(stored.get(reference)) : null } },
    async write(bytes) {
      const reference = 'sha256:' + createHash('sha256').update(bytes).digest('hex')
      stored.set(reference, Uint8Array.from(bytes))
      return { ok: true, value: reference }
    },
  }
  const resolvePath = relativeOrAbsolute => path.resolve(directory, relativeOrAbsolute)
  const service = new FileBaseline({ resolvePath, payloads })
  const original = Buffer.from('\uFEFFbefore\r\n')
  const target = Buffer.from('after\n')
  fs.writeFileSync(resolvePath('subject.txt'), original)
  const paths = ['subject.txt', 'missing.txt']
  const captured = await service.capture(paths)
  assert.equal(captured.ok, true, captured.error)
  const baseline = JSON.parse(captured.value)
  assert.deepEqual(baseline['missing.txt'], { kind: 'Missing' })
  assert.equal(baseline['subject.txt'].kind, 'Present')
  assert.deepEqual(Buffer.from(stored.get(baseline['subject.txt'].payloadRef)), original)
  assert.equal(baseline['subject.txt'].payload_ref, baseline['subject.txt'].payloadRef)
  assert.equal(baseline['subject.txt'].contentHash, baseline['subject.txt'].sha256)

  fs.writeFileSync(resolvePath('subject.txt'), target)
  const compared = await service.compare(paths, captured.value)
  assert.equal(compared.ok, true, compared.error)
  assert.equal(compared.value.refresh, true)
  assert.ok(compared.value.diffSummary.includes('before'))
  assert.ok(compared.value.diffSummary.includes('after'))
  const nextState = JSON.parse(compared.value.targetState)
  assert.deepEqual(Buffer.from(stored.get(nextState['subject.txt'].payloadRef)), target)
  const unchanged = await service.compare(paths, compared.value.targetState)
  assert.equal(unchanged.ok, true, unchanged.error)
  assert.equal(unchanged.value.refresh, false)
  assert.equal(unchanged.value.diffSummary, '')
  fs.writeFileSync(resolvePath('subject.txt'), 'later edit')
  assert.deepEqual(Buffer.from(stored.get(nextState['subject.txt'].payloadRef)), target)

  const readError = 'consumer payload read failure'
  const failed = new FileBaseline({ resolvePath, payloads: { ...payloads, read: async () => ({ ok: false, error: readError }) } })
  const failure = await failed.compare(paths, captured.value)
  assert.equal(failure.ok, false)
  assert.equal(failure.error, readError)
  const rejection = new Error('consumer payload rejection')
  const rejected = new FileBaseline({ resolvePath, payloads: { ...payloads, read: () => Promise.reject(rejection) } })
  await assert.rejects(rejected.compare(paths, captured.value), cause => cause === rejection)
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
console.log('file-baseline consumer passed')
