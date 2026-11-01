import assert from 'node:assert/strict'
import { encode, body, carry, validationError, entries, fullText } from 'wanxiangli/returned-material'
import { CompletionRecord } from 'wanxiangli/handle-lifecycle'
import { createHash } from 'node:crypto'

const expected = '{"body":["report\\r\\nline","quote \\" and \\\\","中文 😀",""],"carry":["artifact","artifact"]}'
const encoded = encode(['report\r\nline', 'quote " and \\', '中文 😀', ''], ['artifact', 'artifact'])
assert.equal(encoded, expected)
assert.equal(validationError(expected), null)
assert.deepEqual(body(encoded), ['report\r\nline', 'quote " and \\', '中文 😀', ''])
assert.deepEqual(carry(encoded), ['artifact', 'artifact'])
assert.deepEqual(entries(encoded), [{ text: 'artifact' }, { text: 'artifact' }])
assert.equal(fullText('{"body":["report",""],"carry":["artifact"]}'), 'report\n\n\n\nartifact')
assert.deepEqual(body('{"body":null,"carry":42}'), [])
assert.deepEqual(carry('{"body":42,"carry":["artifact"]}'), ['artifact'])
assert.throws(() => body('{"carry":[]}'), /returned material body must be a JSON string array/)
assert.throws(() => carry('{"body":[]}'), /returned material carry must be a JSON string array/)
assert.equal(validationError('{"body":null,"carry":[]}'), 'returned material must use the canonical JSON object encoding')
assert.equal(validationError('{"body":[],"carry":null}'), 'returned material must be a canonical { body: string[], carry: string[] } JSON object')
const records = new CompletionRecord()
const completion = records.encode({ kind: 'completed', runId: '', view: encoded, childSessionId: 'child', authorityRoot: 'root', providerRun: 'provider' })
const read = await records.read(
  { ref: 'completion', digest: createHash('sha256').update(completion).digest('hex') },
  async ref => { assert.equal(ref, 'completion'); return { ok: true, value: completion } },
  value => createHash('sha256').update(value).digest('hex'),
)
assert.equal(read.ok, true)
const restored = records.decodeForWork({ childSessionId: 'child', authorityRoot: 'root' }, 'agent', read.value.body)
assert.equal(restored.ok, true)
assert.equal(restored.value.runId, 'run-agent')
assert.equal(restored.value.view, expected)
assert.equal(restored.value.directory, null)
assert.equal(records.decodeForWork(null, 'agent', '{"status":"aborted"}').error, 'legacy false abort is not a joinable completion')
console.log('returned-material consumer passed')
