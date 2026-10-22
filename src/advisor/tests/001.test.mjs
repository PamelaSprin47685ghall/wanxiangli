import test from 'node:test'
import assert from 'node:assert/strict'

import { AdvisorLaw } from 'wanxiangli/advisor'

const law = new AdvisorLaw()
const m = (anchor, text) => ({ anchor, text })
const plain = (v) => JSON.parse(JSON.stringify(v))

test('SPEC[advisor-1] material identity is anchor plus exact text, length-prefixed', () => {
  assert.equal(law.contractVersion, 2)
  assert.equal(law.materialKey(3, 'abc'), '3:3:abc')
  assert.equal(law.materialKey(0, ''), '0:0:')
  // counterexample: naive "anchor:text" would collide here; the length prefix separates them
  assert.notEqual(law.materialKey(1, '2:x'), law.materialKey(12, 'x'))
  assert.notEqual(law.materialKey(0, 'first-opening'), law.materialKey(0, 'second-opening'))
  assert.equal(law.materialKey(1, '名'), '1:1:名')
  assert.equal(law.materialKey(null, 'abc'), 'literal:3:abc')
  assert.notEqual(law.materialKey(null, 'abc'), law.materialKey(0, 'abc'))
  for (const bad of [-1, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => law.materialKey(bad, 'x'), /malformed anchor/)
  assert.throws(() => law.materialKey(1, null), /malformed text/)
})

test('SPEC[advisor-2] first consult delivers the whole view in view order', () => {
  const view = [m(1, 'a'), m(2, 'b'), m(3, 'c')]
  const planned = law.plan([], view)
  assert.deepEqual(plain(planned.delta), view)
  assert.deepEqual(plain(planned.deliveredAnchors), [1, 2, 3])
  assert.deepEqual(plain(planned.deliveredMaterial), ['1:1:a', '2:1:b', '3:1:c'])
  assert.equal(planned.hasNewMaterial, true)
  assert.ok(Object.isFrozen(planned))
})

test('SPEC[advisor-2] follow-ups filter the generated output; a new summary on the same anchor is new', () => {
  const delivered = ['1:1:a', '2:1:b', '3:1:c']
  const same = law.plan(delivered, [m(1, 'a'), m(2, 'b'), m(3, 'c')])
  assert.deepEqual(plain(same.delta), [])
  assert.equal(same.hasNewMaterial, false)
  assert.deepEqual(plain(same.deliveredMaterial), [])
  assert.deepEqual(plain(same.deliveredAnchors), [1, 2, 3])
  // anchor 1 now represents a folded interval: its new summary must be delivered
  const folded = law.plan(delivered, [m(1, 'one-and-two'), m(3, 'c')])
  assert.deepEqual(plain(folded.delta), [m(1, 'one-and-two')])
  assert.deepEqual(plain(folded.deliveredAnchors), [1, 3])
  // implicit zero is permanent and repeatedly replaceable
  const opening = law.plan(['0:13:first-opening'], [m(0, 'second-opening'), m(1, 'a')])
  assert.deepEqual(plain(opening.delta), [m(0, 'second-opening'), m(1, 'a')])
  // input order is kept, not sorted; distinct anchors keep first occurrence
  const unordered = law.plan([], [m(5, 'x'), m(2, 'y'), m(5, 'z')])
  assert.deepEqual(plain(unordered.deliveredAnchors), [5, 2])
  assert.deepEqual(plain(unordered.delta), [m(5, 'x'), m(2, 'y'), m(5, 'z')])
  assert.throws(() => law.plan(null, []), /malformed delivered/)
  assert.throws(() => law.plan([], [{ anchor: 1 }]), /malformed material text/)
  assert.throws(() => law.plan([], [null]), /malformed material entry/)
})

test('SPEC[advisor-2] literals keep exact whitespace and duplicates within one selection', () => {
  const material = [m(null, ''), m(null, '  '), m(7, 'same'), m(null, 'same'), m(7, 'same')]
  const first = law.plan([], material)
  assert.deepEqual(plain(first.delta), material)
  assert.deepEqual(plain(first.deliveredAnchors), [7])
  assert.deepEqual(plain(law.plan(first.deliveredMaterial, material).delta), [])
  assert.deepEqual(plain(law.plan(first.deliveredMaterial, [m(null, 'same\n')]).delta), [m(null, 'same\n')])
})

test('SPEC[advisor-3] ledger is monotone, isolated per caller and per instance, and only record advances it', () => {
  const ledger = law.ledger()
  const other = new AdvisorLaw().ledger()
  assert.deepEqual(ledger.delivered('caller'), [])
  const planned = law.plan(ledger.delivered('caller'), [m(1, 'a'), m(2, 'b')])
  // a failed consult never records: planning again proposes the same delta
  assert.deepEqual(plain(law.plan(ledger.delivered('caller'), [m(1, 'a'), m(2, 'b')]).delta), plain(planned.delta))
  ledger.record('caller', planned.deliveredMaterial)
  ledger.record('caller', planned.deliveredMaterial)
  ledger.record('caller', [])
  assert.deepEqual(ledger.delivered('caller'), ['1:1:a', '2:1:b'])
  assert.deepEqual(ledger.delivered('other'), [])
  assert.deepEqual(other.delivered('caller'), [])
  ledger.record('caller', ['0:1:z'])
  assert.deepEqual(ledger.delivered('caller'), ['0:1:z', '1:1:a', '2:1:b'])
  ledger.record('other', ['9:1:q'])
  ledger.clear('caller')
  assert.deepEqual(ledger.delivered('caller'), [])
  assert.deepEqual(ledger.delivered('other'), ['9:1:q'])
  ledger.clearAll()
  assert.deepEqual(ledger.delivered('other'), [])
  assert.throws(() => ledger.record('caller', [1]), /malformed key/)
  assert.throws(() => ledger.delivered(null), /malformed caller/)
})

test('SPEC[advisor-4] answer is the last non-blank assistant prose, never a user or blank message', () => {
  assert.equal(law.answer([]), null)
  assert.equal(law.answer([{ role: 'user', text: 'question' }]), null)
  assert.equal(law.answer([{ role: 'assistant', text: '   \n' }]), null)
  assert.equal(law.answer([
    { role: 'assistant', text: 'older advice' },
    { role: 'Assistant', text: 'newer advice' },
    { role: 'assistant', text: '' },
    { role: 'user', text: 'follow-up' },
  ]), 'newer advice')
  assert.equal(law.answer([null, { role: 'assistant', text: 'ok' }, { role: 'assistant' }]), 'ok')
  assert.throws(() => law.answer(null), /malformed messages/)
})
