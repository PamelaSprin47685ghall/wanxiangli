import test from 'node:test'
import assert from 'node:assert/strict'
import { Trace } from 'wanxiangli/trace'
import { capturedUser, fresh, whole, canonical, resign, user, part, finish } from './support.mjs'

test('SPEC[trace-005] canonical records restore the same bytes, identities and fixed cuts', () => {
  const trace = capturedUser()
  const checkpoint = trace.head()
  const restored = new Trace('trace-a', trace.records())
  assert.deepEqual(whole(restored), whole(trace))
  assert.deepEqual(restored.inspect(), trace.inspect())
  assert.deepEqual(restored.head(), checkpoint)
  assert.equal(restored.capture(user()).status, 'Replayed')
  assert.equal(restored.capture(part('user-1', '用户原文\r\n🧭 e\u0301')).status, 'Replayed')
  assert.deepEqual(restored.records(), trace.records())
})

for (const [name, corrupt] of [
  ['missing record', rows => rows.filter((_, index) => index !== 1)],
  ['duplicate record', rows => [...rows, rows.at(-1)]],
  ['reordered records', rows => [rows[1], rows[0], ...rows.slice(2)]],
  ['changed byte', rows => rows.map((row, index) => index === 2 ? row.replace('55So', '55Sp') : row)],
  ['extra JSON whitespace', rows => rows.map(row => ` ${row}`)],
  ['invalid JSON', rows => [...rows.slice(0, -1), '{']],
]) test(`SPEC[trace-005] recovery refuses ${name} rather than skipping or repairing`, () => {
  const trace = capturedUser()
  const records = corrupt(trace.records())
  assert.throws(() => new Trace('trace-a', records))
})

for (const [name, alter] of [
  ['unknown vocabulary', frames => { frames[1].observation.type = 'Rewrite' }],
  ['extra field', frames => { frames[1].observation.hostIndex = 12 }],
  ['missing part', frames => { frames[2].observation.index = 1 }],
  ['wrong completed count', frames => { frames[3].observation.partCount = 2 }],
  ['noncanonical base64', frames => { frames[2].observation.base64 += '\n' }],
  ['late opening', frames => { [frames[0], frames[1]] = [frames[1], frames[0]] }],
  ['duplicate identity', frames => { frames.push(structuredClone(frames[1])) }],
]) test(`SPEC[trace-005] even a recomputed chain cannot admit ${name}`, () => {
  const trace = capturedUser()
  const frames = trace.records().map(JSON.parse)
  alter(frames)
  assert.throws(() => new Trace('trace-a', resign(frames)))
})

test('SPEC[trace-005] a saved trusted cut detects tail loss; a valid prefix alone does not prove completeness', () => {
  const trace = capturedUser()
  const shorter = new Trace('trace-a', trace.records().slice(0, -1))
  assert.equal(shorter.inspect().cursor, trace.inspect().cursor - 1)
  assert.throws(() => shorter.read(shorter.cut(0), trace.head()), /beyond/)
  assert.throws(() => new Trace('different-trace', trace.records()), /Foreign/)
})

test('SPEC[trace-005] deterministic replay permutations never allocate new cursors', () => {
  const trace = fresh()
  const observations = []
  for (let index = 0; index < 100; index++) {
    observations.push(user(`u-${index}`), part(`u-${index}`, `原文 ${index}\u0000`), finish(`u-${index}`))
  }
  observations.forEach(value => trace.capture(value))
  const restored = new Trace('trace-a', trace.records())
  for (let index = 0; index < observations.length; index++) {
    const selected = (index * 137) % observations.length
    assert.equal(restored.capture(observations[selected]).cursor, selected + 1)
  }
  assert.deepEqual(restored.records(), trace.records())
  assert.deepEqual(whole(restored), whole(trace))
})

test('SPEC[trace-005] oversized or non-string recovery entries are rejected', () => {
  for (const records of [[null], [1], [new Uint8Array()], [' '.repeat(1048577)], Array(1)]) {
    assert.throws(() => new Trace('trace-a', records))
  }
  assert.throws(() => new Trace('trace-a', { read() { throw new Error('must not call') } }))
})
