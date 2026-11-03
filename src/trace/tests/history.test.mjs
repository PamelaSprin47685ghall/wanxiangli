import test from 'node:test'
import assert from 'node:assert/strict'
import { Trace, TraceHistory, materializeTraceItems, inspectTraceItems } from 'wanxiangli/trace'

const value = result => {
  assert.equal(result.ok, true, JSON.stringify(result, (_, v) => typeof v === 'bigint' ? String(v) : v))
  return result.value
}
const part = (sequence, fields = {}) => ({
  sequence, role: 'assistant', kind: 'text', toolName: null,
  bodyRef: `body-${sequence}`, bodyDigest: `digest-${sequence}`,
  descriptor: `assistant|original|text||body-${sequence}|digest-${sequence}`,
  metadata: { source: sequence }, ...fields,
})
const append = (history, sequence, fields) => value(history.appendPart(part(sequence, fields)))
const terminal = (history, providerRun, fields = {}) => value(history.appendTerminal({ providerRun, bodyRef: 'terminal', bodyDigest: 'digest', ...fields }))
const read = async reference => ({ ok: true, value: reference })

test('TraceHistory copies opening inputs and views, preserves replay identity, and rejects a conflict', () => {
  const empty = new TraceHistory('opening')
  const requirements = ['first', 'second\nwith newline']
  const input = { assignment: '你好\0\uFEFF\nverbatim', requirements }
  const history = value(empty.appendOpening(input))
  requirements[0] = 'changed'
  const opening = history.opening()
  assert.deepEqual(opening, { assignment: input.assignment, requirements: ['first', 'second\nwith newline'], constitutiveBody: '' })
  opening.requirements[0] = 'changed view'
  assert.equal(history.opening().requirements[0], 'first')
  assert.equal(value(history.appendOpening({ assignment: input.assignment, requirements: ['first', 'second\nwith newline'] })), history)
  assert.deepEqual(history.appendOpening({ assignment: 'different', requirements: [] }), { ok: false, error: { kind: 'OpeningAlreadyCaptured' } })
  assert.equal(empty.opening(), null)
  assert.deepEqual(empty.records(), [])
})

test('TraceHistory rejects duplicate and retreating cursors before translating metadata', () => {
  const empty = new TraceHistory('sequence')
  assert.deepEqual(empty.appendPart(part(0n)), { ok: false, error: { kind: 'CursorNotAfterHead', expected: 0n, actual: 0n } })
  let calls = 0
  const metadata = { host: true }
  const first = value(empty.appendPart(part(4n), () => { calls += 1; return metadata }))
  assert.equal(first.entries()[0].metadata, metadata)
  for (const sequence of [4n, 2n, -1n]) {
    assert.deepEqual(first.appendPart(part(sequence), () => { throw Error('must not translate') }), {
      ok: false, error: { kind: 'CursorNotAfterHead', expected: 4n, actual: sequence },
    })
  }
  assert.equal(calls, 1)
  assert.equal(first.headSequence(), 4n)
  assert.equal(first.head(), 5n)
  assert.equal(first.latestSequence(), 4n)
  assert.equal(empty.latestSequence(), null)
})

test('TraceHistory terminal replay is per run and preserves its part frontier', () => {
  const first = append(new TraceHistory('terminals'), 1n)
  const ended = terminal(first, 'run-1')
  assert.equal(value(ended.appendTerminal({ providerRun: 'run-1', bodyRef: 'terminal', bodyDigest: 'digest' })), ended)
  for (const fields of [{ bodyRef: 'other' }, { bodyDigest: 'other' }]) {
    assert.deepEqual(ended.appendTerminal({ providerRun: 'run-1', bodyRef: 'terminal', bodyDigest: 'digest', ...fields }), { ok: false, error: { kind: 'TerminalAlreadyCaptured' } })
  }
  const next = terminal(append(ended, 3n), 'run-2')
  assert.deepEqual(next.terminals().map(t => [t.providerRun, t.frontier]), [['run-1', 2n], ['run-2', 4n]])
  assert.equal(next.latestTerminal().providerRun, 'run-2')
  assert.equal(next.terminalFor('run-1').frontier, 2n)
  assert.equal(next.terminalFor('missing'), null)
  assert.equal(ended.head(), 2n)
  assert.ok(ended.headCut().cursor > first.headCut().cursor)
  assert.deepEqual(ended.afterCoverage(0n).through, first.headCut())
  assert.deepEqual(ended.afterCoverage(100n).after, ended.afterCoverage(100n).through)
})

test('TraceHistory late opening rebuilds all parts before terminal records without changing old branches', () => {
  const empty = new TraceHistory('late')
  const first = append(empty, 1n)
  const ended = terminal(first, 'run-1')
  const second = append(ended, 2n)
  const before = second.records()
  const opened = value(second.appendOpening({ assignment: 'late opening', requirements: ['retain'] }))
  assert.deepEqual(second.records(), before)
  assert.equal(second.opening(), null)
  assert.equal(opened.opening().assignment, 'late opening')
  assert.deepEqual(opened.entries(), second.entries())
  assert.deepEqual(opened.terminals(), second.terminals())
  const trace = new Trace('late', opened.records())
  assert.deepEqual(trace.materialize(trace.cut(0), trace.head()).messages.map(m => m.messageId), ['xmsg-1', 'xmsg-2', 'xterm-msg-12'])
  assert.equal(opened.terminalFor('run-1').frontier, 2n)
})

test('TraceHistory fixed ranges and semantic bigint cuts stay distinct from raw record counts', () => {
  const high = 9007199254740993n
  const first = append(new TraceHistory('bigint'), high)
  const fixed = first.rangeFrom(0n)
  const second = append(first, high + 1n)
  assert.deepEqual(fixed, { start: 0n, end: high + 1n })
  assert.deepEqual(second.slice(fixed).map(p => p.sequence), [high])
  assert.deepEqual(second.rangeFrom(high + 99n), { start: high + 2n, end: high + 2n })
  assert.deepEqual(first.interval(fixed), second.interval(fixed))
  assert.equal(typeof first.headCut().cursor, 'number')
  assert.equal(typeof first.head(), 'bigint')
  assert.deepEqual(second.cutAt(high), first.headCut())
  assert.equal(second.interval({ start: high, end: high + 1n }).after.cursor, 0)
  assert.throws(() => second.slice({ start: high + 2n, end: 0n }), /Trace interval is reversed/)
})

test('TraceHistory long append chains and two continuations do not share mutable Trace state', async () => {
  let history = new TraceHistory('branches')
  for (let i = 1n; i <= 80n; i += 1n) history = append(history, i)
  const records = history.records()
  const left = append(history, 81n, { bodyRef: 'left', descriptor: 'left' })
  const right = append(history, 81n, { bodyRef: 'right', descriptor: 'right' })
  assert.deepEqual(history.records(), records)
  assert.equal(history.entries().length, 80)
  assert.equal(value(await left.materialize({ start: 81n, end: 82n }, read))[0].part.text, 'left')
  assert.equal(value(await right.materialize({ start: 81n, end: 82n }, read))[0].part.text, 'right')
  const exported = left.entries()
  exported[0].bodyRef = 'mutated'
  exported.pop()
  assert.equal(left.entries()[0].bodyRef, 'body-1')
  assert.equal(left.entries().length, 81)
  const copiedRecords = left.records()
  copiedRecords.pop()
  assert.equal(left.records().length, records.length + 5)
})

test('TraceHistory selected reads preserve caller order, duplicate entries and opaque metadata', async () => {
  const history = append(append(new TraceHistory('read-order'), 1n), 2n, { kind: 'reasoning' })
  const [first, second] = history.entries()
  const calls = []
  const result = value(await history.read([second, first, second], async reference => { calls.push(reference); return { ok: true, value: reference } }))
  assert.deepEqual(calls, ['body-2', 'body-1', 'body-2'])
  assert.deepEqual(result.map(item => item.sequence), [2n, 1n, 2n])
  assert.equal(result[0].metadata, second.metadata)
  assert.equal(result[0].part.kind, 'reasoning')
})

test('TraceHistory read failures stop in place; unknown kinds and missing tool names are checked after read', async () => {
  const history = new TraceHistory('read-errors')
  const entries = [part(1n, { kind: 'unknown' }), part(2n)]
  const calls = []
  assert.deepEqual(await history.read(entries, async reference => { calls.push(reference); return { ok: false, error: 'missing' } }), {
    ok: false, error: 'XTrace materialization could not read body-1: missing',
  })
  assert.deepEqual(calls, ['body-1'])
  assert.deepEqual(await history.read(entries, read), { ok: false, error: 'XTrace contains an unknown semantic part kind: unknown' })
  assert.deepEqual(await history.read([part(1n, { kind: 'tool_call' })], read), { ok: false, error: 'XTrace tool_call is missing its tool name' })
  assert.deepEqual(value(await history.read([part(1n, { kind: 'tool_call', toolName: '' })], read))[0].part, { kind: 'tool_call', name: '', args: 'body-1' })
  const rejection = { rejected: true }
  await assert.rejects(history.read(entries, async () => { throw rejection }), error => error === rejection)
})

test('TraceHistory ordinary reads keep body strings, while materialize performs UTF-8 normalization without hashing', async () => {
  const history = append(new TraceHistory('unicode'), 1n, { bodyDigest: 'intentionally-unchecked' })
  const body = '\uFEFF\0\uD800end'
  const reader = async () => ({ ok: true, value: body })
  assert.equal(value(await history.read(history.entries(), reader))[0].part.text, body)
  assert.equal(value(await history.materialize(history.rangeFrom(0n), reader))[0].part.text, Buffer.from(body).toString('utf8'))
  const media = value(await history.read([part(2n, { kind: 'media_omitted' })], async () => ({ ok: true, value: ' \n' })))[0].part
  assert.deepEqual(media, { kind: 'media', mediaType: null, digest: '' })
})

test('TraceHistory pure item materialization keeps complete semantic payloads across 512 KiB chunks', () => {
  const large = '\uFEFFstart\0' + '你😀'.repeat(110000) + '\nend'
  const parts = [
    { kind: 'text', text: large }, { kind: 'reasoning', text: large },
    { kind: 'tool_call', name: '工😀具:\nname', args: large },
    { kind: 'tool_result', text: large },
    { kind: 'media', mediaType: 'image/😀:\nraw', digest: 'digest:\nraw' },
    { kind: 'media', mediaType: null, digest: 'none' },
  ]
  const items = parts.map((part, i) => ({ sequence: BigInt(i + 1), role: i === 0 ? 'user' : 'assistant', part, metadata: { i } }))
  const range = { start: 0n, end: 7n }
  const result = materializeTraceItems(range, items)
  assert.deepEqual(result, items)
  for (let i = 0; i < items.length; i += 1) assert.equal(result[i].metadata, items[i].metadata)
  const inspection = inspectTraceItems('inspection', 'opening', range, items)
  assert.equal(inspection.materializedCount, 6)
  assert.equal(inspection.window.originals[0].parts.length, 2)
  assert.equal(inspection.window.opening.text, 'opening')
  assert.ok(inspection.head.cursor > items.length)
  assert.deepEqual(materializeTraceItems({ start: 2n, end: 4n }, items), items.slice(1, 3))
  assert.deepEqual(materializeTraceItems({ start: 2n, end: 2n }, items), [])
})

test('TraceHistory stores complete opening text while its raw opening record keeps the existing byte bound', () => {
  const assignment = '你'.repeat(180000)
  const history = value(new TraceHistory('opening-bound').appendOpening({ assignment, requirements: ['tail'] }))
  assert.equal(history.opening().assignment, assignment)
  const trace = new Trace('opening-bound', history.records())
  const raw = trace.materialize(trace.cut(0), trace.head()).opening.bytes
  const envelope = Buffer.from(`assignment:${assignment.length}:${assignment}\ntail`)
  assert.equal(raw.length, 524288)
  assert.deepEqual(Buffer.from(raw), envelope.subarray(0, 524288))
})
