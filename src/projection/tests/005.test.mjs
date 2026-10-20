import test from 'node:test'
import assert from 'node:assert/strict'
import { Projection } from '../../../dist/projection/Projection.js'

const p = Projection()
const base = (messages, over = {}) => ({ provider: null, model: null, variant: null, tools: [], system: [], messages, ...over })

test('SPEC[projection-005] wire bytes keep field order, call ids and the five historical escapes exactly', () => {
  const wire = base(
    [
      { role: 'user', parts: [{ kind: 'text', text: 'a"b\\c\nd\re\tf' }] },
      {
        role: 'assistant',
        parts: [
          { kind: 'reasoning', text: 'r' },
          { kind: 'tool-call', callId: 'c1', name: 'run', args: '{"x":1}' },
          { kind: 'tool-result', callId: 'c1', result: 'ok' },
          { kind: 'media', mediaType: null, contentDigest: 'd' },
        ],
      },
    ],
    { provider: 'p', model: '', tools: ['t1', 't2'], system: ['s'] },
  )
  assert.equal(
    p.wire(wire),
    '{"provider":"p","model":"","variant":null,"tools":["t1","t2"],"system":["s"],"messages":[' +
      '{"role":"user","parts":[{"kind":"text","text":"a\\"b\\\\c\\nd\\re\\tf"}]},' +
      '{"role":"assistant","parts":[{"kind":"reasoning","text":"r"},' +
      '{"kind":"tool-call","callId":"c1","name":"run","args":"{\\"x\\":1}"},' +
      '{"kind":"tool-result","callId":"c1","result":"ok"},' +
      '{"kind":"media","mediaType":null,"contentDigest":"d"}]}]}',
  )
  // absent optional fields render exactly like null
  const { provider, model, variant, ...rest } = base([])
  assert.equal(p.wire(rest), p.wire(base([])))
})

test('SPEC[projection-005] other control characters, unicode and lone surrogates pass through unescaped', () => {
  const odd = '\u0001\u007f\u2028é😀\ud800'
  const bytes = p.wire(base([{ role: 'user', parts: [{ kind: 'text', text: odd }] }]))
  assert.ok(bytes.includes('"text":"' + odd + '"'))
})

test('SPEC[projection-005] wireMessage is exactly the message element inside wire', () => {
  const message = { role: 'tool', parts: [{ kind: 'tool-result', callId: 'k', result: 'x\ny' }] }
  const one = p.wireMessage(message)
  assert.equal(one, '{"role":"tool","parts":[{"kind":"tool-result","callId":"k","result":"x\\ny"}]}')
  assert.ok(p.wire(base([message])).endsWith('"messages":[' + one + ']}'))
})

test('SPEC[projection-005] semantic bytes carry no call ids and refuse wire parts', () => {
  const semantic = base([
    {
      role: 'assistant',
      parts: [
        { kind: 'tool-call', name: 'run', args: 'a' },
        { kind: 'tool-result', result: 'b' },
      ],
    },
  ])
  assert.equal(
    p.semantic(semantic),
    '{"provider":null,"model":null,"variant":null,"tools":[],"system":[],"messages":[' +
      '{"role":"assistant","parts":[{"kind":"tool-call","name":"run","args":"a"},{"kind":"tool-result","result":"b"}]}]}',
  )
  assert.throws(() => p.semantic(base([{ role: 'a', parts: [{ kind: 'tool-call', callId: 'c', name: 'n', args: '' }] }])), /must not carry a callId/)
  assert.throws(() => p.wire(base([{ role: 'a', parts: [{ kind: 'tool-result', result: '' }] }])), /callId must be a string/)
})

test('SPEC[projection-005] malformed views are refused, not rendered', () => {
  const bad = [
    null,
    base([{ role: 'u', parts: [{ kind: 'image', text: 'x' }] }]),
    base([{ role: 1, parts: [] }]),
    base([{ role: 'u', parts: [{ kind: 'text', text: 1 }] }]),
    base([], { tools: ['a', 2] }),
    base([], { system: 's' }),
    base([], { provider: 3 }),
    base([{ role: 'u', parts: [{ kind: 'media', mediaType: 1, contentDigest: 'd' }] }]),
    base(Array(2)),
  ]
  for (const view of bad) assert.throws(() => p.wire(view))
  const accessor = base([])
  Object.defineProperty(accessor, 'model', { get: () => 'm', enumerable: true })
  assert.throws(() => p.wire(accessor), /Accessor/)
  assert.throws(() => p.semantic(accessor), /Accessor/)
})
