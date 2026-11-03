import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { LocalIntegrator } from 'wanxiangli/local-eventstore'
import { CanonicalEventCodec } from 'wanxiangli/events'
import { SegmentedWriter } from 'wanxiangli/segments'
import { RuleQuarantine } from 'wanxiangli/quarantine'

const codec = new CanonicalEventCodec()
const quarantine = new RuleQuarantine()
const ok = value => ({ ok: true, value })
const fail = error => ({ ok: false, error })
const value = result => { assert.equal(result.ok, true, result.error); return result.value }
const event = (id, fields = {}) => ({ id, stream: 'work', type: 'Fact', parents: [], payload: {}, payloadRefs: [], payloads: {}, ...fields })
const options = rules => ({ rules, isKnownEventType: type => ['Fact', 'ProjectionCutTail'].includes(type) })
const rule = (fields = {}) => ({
  name: 'Journal', initial: [], accepts: event => event.type === 'Fact',
  faultScope: event => event.stream,
  integrate: (current, event) => ok([...current, event.id]),
  planCut: () => ok({ resetJson: '[]' }),
  applyCut: (_, reset) => ok(JSON.parse(reset)),
  ...fields,
})
const directory = t => {
  const root = mkdtempSync(path.join(tmpdir(), 'local-integrator-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
const appendFile = (root, writerId, events) => {
  const writer = new SegmentedWriter({ directory: () => root, writerId, segmentCap: 1024 * 1024 })
  assert.equal(writer.append(events.map(event => codec.encode(event)).join('')).ok, true)
}

test('LocalIntegrator prepares opaque rule state and structural heads together, then publishes once', () => {
  const initial = { order: [] }
  const next = { order: ['a'] }
  const integrator = new LocalIntegrator(options([rule({ initial, integrate: () => ok(next) })]))
  const prepared = value(integrator.prepare([event('a')]))
  assert.equal(integrator.current('Journal'), initial)
  assert.equal(integrator.event('a'), null)
  assert.deepEqual(integrator.heads('work'), [])
  prepared.commit()
  assert.equal(integrator.current('Journal'), next)
  assert.equal(integrator.event('a').id, 'a')
  assert.deepEqual(integrator.heads('work'), ['a'])
  assert.equal(integrator.head('work'), 'a')
  assert.deepEqual(integrator.allHeads(), ['a'])
  assert.throws(() => prepared.commit(), /Current changed between prepare and durable append/)
})

test('LocalIntegrator candidate commit rejects a later commit or reload without overwriting Current', t => {
  const root = directory(t)
  const integrator = new LocalIntegrator(options([rule()]))
  const first = value(integrator.prepare([event('a')]))
  const second = value(integrator.prepare([event('b')]))
  second.commit()
  assert.throws(() => first.commit(), /CanonicalIntegrator Current changed between prepare and durable append/)
  assert.deepEqual(integrator.current('Journal'), ['b'])
  const stale = value(integrator.prepare([event('c')]))
  value(integrator.reload(() => root))
  assert.throws(() => stale.commit(), /CanonicalIntegrator Current changed between prepare and durable append/)
  assert.deepEqual(integrator.current('Journal'), [])
  assert.equal(integrator.event('b'), null)
})

test('LocalIntegrator tracks concurrent frontiers, normalizes parents and indexes payloads only on commit', () => {
  const integrator = new LocalIntegrator(options([rule()]))
  const bytes = Uint8Array.from([0, 1, 255])
  const reference = createHash('sha256').update(bytes).digest('hex')
  value(integrator.prepare([event('b'), event('a')])).commit()
  assert.deepEqual(integrator.heads('work'), ['a', 'b'])
  assert.equal(integrator.head('work'), null)
  const prepared = value(integrator.prepare([event('c', { parents: ['b', 'a', 'b'], payloadRefs: [reference, reference], payloads: { [reference]: bytes } })]))
  assert.equal(integrator.payload(reference), null)
  assert.deepEqual(prepared.durableEvents[0].parents, ['a', 'b'])
  assert.deepEqual(prepared.durableEvents[0].payloadRefs, [reference])
  prepared.commit()
  assert.equal(integrator.payload(reference), bytes)
  assert.deepEqual(integrator.heads('work'), ['c'])
  const replay = value(integrator.prepare([event('c', { parents: ['a', 'b'], payloadRefs: [reference], payloads: { [reference]: bytes } })]))
  assert.equal(replay.durableEvents.length, 1)
  const before = integrator.current('Journal')
  replay.commit()
  assert.equal(integrator.current('Journal'), before)
})

test('LocalIntegrator reports missing parents and identity conflicts without changing state', () => {
  const formatted = []
  const integrator = new LocalIntegrator({ ...options([rule()]), formatStorageError: error => { formatted.push(error); return `typed:${error.code}:${error.eventId}` } })
  assert.deepEqual(integrator.prepare([event('child', { parents: ['missing'] })]), { ok: false, error: 'missing parent during integration: missing' })
  value(integrator.prepare([event('same')])).commit()
  assert.deepEqual(integrator.prepare([event('same', { payload: { changed: true } })]), { ok: false, error: 'identity collision: typed:IdentityCollision:same' })
  assert.deepEqual(formatted, [{ code: 'IdentityCollision', eventId: 'same' }])
  assert.deepEqual(integrator.current('Journal'), ['same'])
})

test('LocalIntegrator emits the failed event and its cut together while rule state stays opaque', () => {
  const calls = []
  const original = { good: ['before'] }
  const reset = { good: ['reset'] }
  const integrator = new LocalIntegrator(options([rule({
    initial: original,
    integrate: (current, event) => { assert.equal(current, original); calls.push(['integrate', event.id]); return fail('semantic failure') },
    planCut: (current, event, reason, afterReplay) => { assert.equal(current, original); calls.push(['plan', event.id, reason, afterReplay]); return ok({ resetJson: 'opaque-reset' }) },
    applyCut: (current, resetJson) => { assert.equal(current, original); calls.push(['apply', resetJson]); return ok(reset) },
  })]))
  const prepared = value(integrator.prepare([event('bad')]))
  assert.equal(integrator.current('Journal'), original)
  assert.deepEqual(prepared.durableEvents.map(event => event.type), ['Fact', 'ProjectionCutTail'])
  const cut = prepared.durableEvents[1]
  assert.equal(cut.stream, 'integrator/cut-tail/Journal')
  assert.match(cut.id, /^[0-9a-f]{32}$/)
  assert.deepEqual(cut.parents, ['bad'])
  assert.deepEqual(cut.payload, { rule: 'Journal', failed_event_id: 'bad', reason: 'semantic failure', reset_json: 'opaque-reset' })
  assert.deepEqual(prepared.cuts, [{ rule: 'Journal', failedEventId: 'bad', reason: 'semantic failure', cutEventId: cut.id }])
  assert.deepEqual(calls, [['integrate', 'bad'], ['plan', 'bad', 'semantic failure', false], ['apply', 'opaque-reset'], ['apply', 'opaque-reset']])
  prepared.commit()
  assert.equal(integrator.current('Journal'), reset)
  assert.equal(integrator.event('bad').id, 'bad')
  assert.deepEqual(integrator.allHeads(), [cut.id, 'bad'])
})

test('LocalIntegrator replay quarantines only one rule scope until its durable cut appears', t => {
  const root = directory(t)
  const events = [
    event('a-good'),
    event('b-bad', { parents: ['a-good'], payload: { bad: true } }),
    event('c-skipped', { parents: ['b-bad'] }),
    event('d-other', { stream: 'other' }),
    event('e-cut', { stream: 'integrator/cut-tail/Journal', type: 'ProjectionCutTail', parents: ['b-bad'], payload: quarantine.encodeCut({ rule: 'Journal', failedEventId: 'b-bad', reason: 'bad', resetJson: '["reset"]' }) }),
    event('f-after', { parents: ['c-skipped'] }),
  ]
  appendFile(root, 'writer', events)
  const visited = []
  const integrator = new LocalIntegrator(options([rule({ integrate: (current, event) => {
    visited.push(event.id)
    return event.payload.bad ? fail('bad') : ok([...current, event.id])
  } })]))
  value(integrator.reload(() => root))
  assert.deepEqual(visited, ['a-good', 'b-bad', 'd-other', 'f-after'])
  assert.deepEqual(integrator.current('Journal'), ['reset', 'f-after'])
  assert.equal(integrator.event('c-skipped').id, 'c-skipped')
  assert.deepEqual(integrator.heads('work'), ['f-after'])
  const pending = value(integrator.prepare([event('g-live', { parents: ['f-after'] })]))
  assert.deepEqual(pending.cuts, [])
  pending.commit()
  assert.deepEqual(integrator.current('Journal'), ['reset', 'f-after', 'g-live'])
})

test('LocalIntegrator retained replay permits aged-out parents and checks stored closure before rule callbacks', t => {
  const root = directory(t)
  appendFile(root, 'writer', [event('retained', { parents: ['aged-out'] })])
  const integrator = new LocalIntegrator(options([rule()]))
  value(integrator.reload(() => root))
  assert.deepEqual(integrator.current('Journal'), ['retained'])
  assert.deepEqual(integrator.prepare([event('live', { parents: ['aged-out'] })]), { ok: false, error: 'missing parent during integration: aged-out' })
  const invalidRoot = directory(t)
  appendFile(invalidRoot, 'writer', [event('unrecognized', { type: 'Unknown', payloadRefs: ['missing'] })])
  let called = false
  const unknown = new LocalIntegrator(options([rule({ integrate: () => { called = true; return ok([]) } })]))
  assert.deepEqual(unknown.reload(() => invalidRoot), { ok: false, error: 'unknown durable event type during replay: Unknown' })
  assert.equal(called, false)
  const missingRoot = directory(t)
  appendFile(missingRoot, 'writer', [event('missing', { payloadRefs: ['missing'] })])
  assert.deepEqual(unknown.reload(() => missingRoot), { ok: false, error: 'missing durable inline payload during replay: missing' })
})

test('LocalIntegrator reload preserves its Current on read failure and propagates callback exceptions', t => {
  const root = directory(t)
  const integrator = new LocalIntegrator({ ...options([rule()]), formatStorageError: error => `format:${error.code}` })
  value(integrator.prepare([event('a')])).commit()
  const current = integrator.current('Journal')
  writeFileSync(path.join(root, 'writer-0000.ndjson'), 'incomplete')
  assert.deepEqual(integrator.reload(() => root), { ok: false, error: 'local event history read failed: format:NonCanonical' })
  assert.equal(integrator.current('Journal'), current)
  const thrown = { callback: true }
  const throwing = new LocalIntegrator(options([rule({ integrate: () => { throw thrown } })]))
  assert.throws(() => throwing.prepare([event('bad')]), error => error === thrown)
  assert.equal(throwing.event('bad'), null)
})

test('LocalIntegrator shares one full-replay fallback budget across all instances in the process', t => {
  const root = directory(t)
  const attempts = []
  const make = () => new LocalIntegrator(options([rule({
    integrate: () => fail('cannot fold'),
    planCut: (_, event, reason, afterReplay) => {
      attempts.push([event.id, reason, afterReplay])
      return afterReplay ? ok({ resetJson: '[]' }) : fail('need full history')
    },
  })]))
  const first = make()
  const second = make()
  value(first.reload(() => root))
  value(second.reload(() => root))
  const prepared = value(first.prepare([event('first')]))
  assert.deepEqual(attempts, [['first', 'cannot fold', false], ['first', 'cannot fold', true]])
  prepared.commit()
  assert.deepEqual(second.prepare([event('second')]), { ok: false, error: 'cut-tail inference failed and full replay budget is unavailable: need full history' })
  assert.equal(second.event('second'), null)
  assert.deepEqual(second.current('Journal'), [])
})
