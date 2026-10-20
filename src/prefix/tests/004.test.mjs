import test from 'node:test'
import assert from 'node:assert/strict'
import { Prefix } from 'wanxiangli/prefix'

const prefix = new Prefix()
const wire = (messages, overrides = {}) => ({
  provider: 'openai', model: 'gpt-4o', variant: 'deep', tools: ['read', 'write'], system: ['sys'], messages, ...overrides,
})
const W1 = wire(['u:first'])
const W2 = wire(['u:first', 'a:second'])

test('SPEC[prefix-1] an exact message prefix with identical identity is an append, and is directional', () => {
  assert.deepEqual(prefix.classify(W1, W2), { append: true, breaks: [] })
  assert.deepEqual(prefix.classify(W1, W1), { append: true, breaks: [] })
  assert.deepEqual(prefix.classify(W2, W1), { append: false, breaks: ['history-shorter'] })
})

test('SPEC[prefix-1] changed tools, model, variant, provider or system is never an append', () => {
  for (const [field, value, label] of [
    ['tools', ['read'], 'tools'], ['tools', ['read', 'write', 'grep'], 'tools'], ['tools', ['write', 'read'], 'tools'],
    ['model', 'gpt-4o-mini', 'model'], ['variant', 'fast', 'variant'], ['variant', null, 'variant'],
    ['provider', 'anthropic', 'provider'], ['system', ['sys-2'], 'system'],
  ]) {
    const next = wire(['u:first', 'a:second'], { [field]: value })
    assert.deepEqual(prefix.classify(W1, next), { append: false, breaks: [label] }, `${field}=${JSON.stringify(value)}`)
  }
})

test('SPEC[prefix-1] one changed historical byte breaks the law; reordering two messages too', () => {
  const nul = wire(['u:first\u0000', 'a:second'])
  assert.deepEqual(prefix.classify(W1, nul).breaks, ['history-changed'])
  const swapped = wire(['a:second', 'u:first'])
  assert.deepEqual(prefix.classify(W2, swapped).breaks, ['history-changed'])
  assert.deepEqual(prefix.classify(W2, wire(['u:first', 'a:second'], { tools: [] })).breaks, ['tools'])
})

test('SPEC[prefix-1] random extensions of a base are appends; random single-byte edits are not', () => {
  let seed = 7
  const rand = n => (seed = (seed * 1103515245 + 12345) % 2147483648) % n
  for (let round = 0; round < 200; round++) {
    const base = Array.from({ length: 1 + rand(5) }, (_, i) => `m${i}:${'x'.repeat(rand(4))}`)
    const extension = Array.from({ length: rand(4) }, (_, i) => `e${i}`)
    assert.equal(prefix.classify(wire(base), wire([...base, ...extension])).append, true)
    const index = rand(base.length)
    const edited = base.map((m, i) => (i === index ? `${m}!` : m))
    assert.equal(prefix.classify(wire(base), wire([...edited, ...extension])).append, false)
  }
})
