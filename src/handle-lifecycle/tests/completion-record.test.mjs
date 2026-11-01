import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { CompletionRecord } from 'wanxiangli/handle-lifecycle'

const records = new CompletionRecord()
const view = '{"body":["raw\\r\\n"],"carry":["后"]}'
const completed = { kind: 'completed', runId: 'run', view, childSessionId: 'child', authorityRoot: 'root', providerRun: 'provider', directory: ' /tmp/raw ' }
const work = { childSessionId: 'child', authorityRoot: 'root' }
const sha256 = body => createHash('sha256').update(body).digest('hex')
const invalid = (kind, reason, message) => ({ kind: 'invalid', error: { kind, reason, message } })

test('completion record keeps canonical schema 4 bytes and failed/abandoned encodings', () => {
  const encoded = records.encode(completed)
  assert.equal(encoded, '{"authority_root":"root","child_session_id":"child","directory":" /tmp/raw ","finality":"completed","provider_run":"provider","run_id":"run","schemaVersion":4,"view":"{\\"body\\":[\\"raw\\\\r\\\\n\\"],\\"carry\\":[\\"后\\"]}"}')
  assert.deepEqual(records.decode(encoded), { kind: 'current', payload: completed })
  assert.equal(records.encode({ kind: 'failed', runId: 'run', code: 'PIPE', message: 'raw\r\n', childSessionId: null }), '{"child_session_id":"","code":"PIPE","finality":"failed","message":"raw\\r\\n","run_id":"run","schemaVersion":4}')
  assert.equal(records.encode({ kind: 'abandoned', runId: 'run', agentId: 'agent', reason: 'stop' }), '{"agent_id":"agent","child_session_id":"","code":"ABANDONED","finality":"failed","message":"stop","run_id":"run","schemaVersion":4}')
  assert.equal(records.encode({ kind: 'failed', runId: null, code: null, message: null }), '{"child_session_id":"","code":null,"finality":"failed","message":null,"run_id":null,"schemaVersion":4}')
  const withoutIds = JSON.parse(records.encode({ kind: 'completed', runId: 'run', view, childSessionId: null, authorityRoot: null, providerRun: null, directory: null }))
  assert.equal(withoutIds.child_session_id, '')
  assert.equal(withoutIds.authority_root, '')
  assert.equal(withoutIds.provider_run, '')
  assert.equal(withoutIds.directory, '')
})

test('completion material is checked before encoding and after completed classification', () => {
  const reason = 'returned material must use the canonical JSON object encoding'
  const noncanonical = '{ "body": [], "carry": [] }'
  assert.throws(() => records.encode({ ...completed, view: noncanonical }), { message: `${reason} (Parameter 'outcome')` })
  assert.deepEqual(records.decode(JSON.stringify({ schemaVersion: 4, finality: 'completed', view: noncanonical })), invalid('IncompletePayload', reason, reason))
  assert.equal(records.decode(JSON.stringify({ schemaVersion: 4, finality: 'failed', view: noncanonical })).kind, 'current')
})

test('legacy abort wins before schema and material checks and retains the original body', () => {
  const body = ' { "status": "aborted", "schemaVersion": 99, "finality": "completed", "view": "invalid", "run_id": "r", "code": "C", "message": "m", "child_session_id": "c" }\n'
  assert.deepEqual(records.decode(body), { kind: 'legacy-false-abort', payload: { status: 'aborted', runId: 'r', code: 'C', message: 'm', childSessionId: 'c', rawBody: body } })
  assert.equal(records.decode('{"schemaVersion":4,"finality":"aborted"}').kind, 'legacy-false-abort')
  assert.deepEqual(records.decodeForWork(null, 'agent', body), { ok: false, error: 'legacy false abort is not a joinable completion' })
})

test('decode preserves missing, explicit null, old schema and finality error order', () => {
  for (const body of ['{}', 'null', '[]', '4', '"text"']) {
    assert.deepEqual(records.decode(body), invalid('MissingSchemaVersion', '', 'missing schemaVersion'))
  }
  for (const [schema, expected] of [[null, ''], [3, '3'], [{ x: 1 }, '{ x = 1 }']]) {
    assert.deepEqual(records.decode(JSON.stringify({ schemaVersion: schema, finality: 'unknown' })), invalid('UnknownSchemaVersion', expected, `unknown schemaVersion: ${expected}`))
  }
  assert.deepEqual(records.decode('{"schemaVersion":4}'), invalid('MissingFinality', '', 'missing finality'))
  assert.deepEqual(records.decode('{"schemaVersion":4,"finality":null}'), invalid('UnknownFinality', '', 'unknown finality: '))
  assert.deepEqual(records.decode('{"schemaVersion":4,"finality":"other"}'), invalid('UnknownFinality', 'other', 'unknown finality: other'))
  let reason
  try { JSON.parse('{') } catch (error) { reason = error.message }
  assert.deepEqual(records.decode('{'), invalid('InvalidJson', reason, `invalid json: ${reason}`))
  assert.deepEqual(records.decodeForWork(null, 'a', '{}'), { ok: false, error: 'completion blob decode failed: missing schemaVersion' })
})

test('decode keeps own-property checks and Fable field coercion instead of JS String', () => {
  const body = JSON.stringify({ schemaVersion: '4', finality: 'failed', run_id: ['a', 2], code: { x: 'a', y: [1, 2] }, message: false, child_session_id: null })
  assert.deepEqual(records.decode(body), { kind: 'current', payload: { kind: 'failed', runId: 'a,2', code: '{ x = "a"\n  y = 1,2 }', message: 'false', childSessionId: '' } })
  assert.equal(records.decode('{"schemaVersion":[4],"finality":["failed"]}').kind, 'current')
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'schemaVersion')
  try {
    Object.defineProperty(Object.prototype, 'schemaVersion', { configurable: true, value: 4 })
    assert.deepEqual(records.decode('{"finality":"failed"}'), invalid('MissingSchemaVersion', '', 'missing schemaVersion'))
  } finally {
    if (descriptor) Object.defineProperty(Object.prototype, 'schemaVersion', descriptor)
    else delete Object.prototype.schemaVersion
  }
})

test('work matching keeps completed and failed identity boundaries distinct', () => {
  assert.equal(records.belongsToWork(work, completed), true)
  assert.equal(records.belongsToWork(work, { ...completed, providerRun: 'another' }), true)
  for (const patch of [{ childSessionId: 'other' }, { authorityRoot: 'other' }, { providerRun: ' \t' }]) {
    assert.equal(records.belongsToWork(work, { ...completed, ...patch }), false)
  }
  const failed = { kind: 'failed', runId: '', childSessionId: 'child', code: '', message: '' }
  assert.equal(records.belongsToWork({ ...work, authorityRoot: 'other' }, failed), true)
  assert.equal(records.belongsToWork({ ...work, childSessionId: 'other' }, failed), false)
  const body = records.encode({ ...completed, authorityRoot: 'other' })
  assert.deepEqual(records.decodeForWork(work, 'agent', body), { ok: false, error: 'completion body does not belong to its exact work' })
  assert.equal(records.decodeForWork(null, 'agent', body).ok, true)
})

test('materialization normalizes only blank option fields and run-id fallback', () => {
  const payload = { ...completed, runId: '\t', childSessionId: ' ', authorityRoot: '\n', providerRun: '', directory: '\r\n' }
  assert.deepEqual(records.materialize('agent', payload), { kind: 'completed', runId: 'run-agent', view, childSessionId: null, authorityRoot: null, providerRun: null, directory: null })
  assert.deepEqual(records.materialize('agent', completed), completed)
  assert.deepEqual(records.materialize('agent', { kind: 'failed', runId: '', childSessionId: '', code: ' ', message: '\r\n' }), { kind: 'failed', runId: 'run-agent', childSessionId: null, code: ' ', message: '\r\n' })
  assert.deepEqual(records.decodeForWork(work, 'agent', records.encode({ ...completed, runId: ' ' })), { ok: true, value: { ...completed, runId: 'run-agent' } })
})

test('read checks the pair before any I/O and preserves empty but present references', async () => {
  const never = () => assert.fail('must not read or hash')
  assert.deepEqual(await records.read({ ref: null, digest: null }, never, never), { ok: true, value: null })
  for (const reference of [{ ref: 'r', digest: null }, { ref: null, digest: 'd' }]) {
    assert.deepEqual(await records.read(reference, never, never), { ok: false, error: 'completion blob ref/digest pair is incomplete' })
  }
  const calls = []
  const body = 'raw\r\n'
  const digest = sha256(body)
  const result = await records.read({ ref: '', digest }, async ref => { calls.push(ref); return { ok: true, value: body } }, value => { calls.push(value); return sha256(value) })
  assert.deepEqual(calls, ['', body])
  assert.deepEqual(result, { ok: true, value: { body, ref: '', digest } })
})

test('read checks raw digest before decoding and never rewrites or rereads material', async () => {
  let reads = 0
  const read = async () => { reads++; return { ok: true, value: '{' } }
  assert.deepEqual(await records.read({ ref: 'blob', digest: 'expected' }, read, sha256), { ok: false, error: 'completion blob digest mismatch: expected' })
  assert.equal(reads, 1)
  const result = await records.read({ ref: 'blob', digest: sha256('{') }, read, sha256)
  assert.deepEqual(result, { ok: true, value: { body: '{', ref: 'blob', digest: sha256('{') } })
  assert.equal(reads, 2)
  assert.equal(records.decode(result.value.body).error.kind, 'InvalidJson')
})

test('read failures and rejected callbacks keep their original result and identity', async () => {
  const reference = { ref: 'blob', digest: 'digest' }
  const failed = { ok: false, error: 'storage refused' }
  assert.deepEqual(await records.read(reference, async () => failed, () => assert.fail('must not hash')), failed)
  const rejected = new Error('storage rejected')
  await assert.rejects(records.read(reference, async () => { throw rejected }, sha256), error => error === rejected)
  await assert.rejects(records.read(reference, () => { throw rejected }, sha256), error => error === rejected)
  await assert.rejects(records.read(reference, async () => ({ ok: true, value: 'body' }), () => { throw rejected }), error => error === rejected)
})
