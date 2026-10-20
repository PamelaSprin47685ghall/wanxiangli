import test from 'node:test'
import assert from 'node:assert/strict'
import { Ablation, node } from './support.mjs'

const law = Ablation()
const nodes = [node('a'), node('b'), node('c')]

test('SPEC[ablation-002] an acyclic graph has no cycle; other edge kinds are ignored', () => {
  assert.equal(law.findCycle(nodes, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', kind: 'borrow' }]), null)
  assert.equal(law.findCycle(nodes, [{ from: 'a', to: 'b' }, { from: 'b', to: 'a', kind: 'note' }]), null)
})

test('SPEC[ablation-002] cycles through either edge kind are rejected', () => {
  for (const kind of ['station-order', 'borrow']) {
    assert.deepEqual(law.findCycle(nodes, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a', kind }]), {
      kind: 'DagViolation',
      reason: 'Cycle detected involving edge c -> a',
    })
  }
  assert.equal(law.findCycle(nodes, [{ from: 'b', to: 'b' }]).reason, 'Cycle detected involving edge b -> b')
})

test('SPEC[ablation-002] edges to undeclared nodes are not followed', () => {
  assert.equal(law.findCycle([node('a')], [{ from: 'a', to: 'ghost' }, { from: 'ghost', to: 'a' }]), null)
})

const allowed = (kind, from, to) => {
  const atLeast = (m) => m !== 'ablated'
  return kind === 'station-order' ? !(to === 'active' && !atLeast(from)) : !(atLeast(to) && !atLeast(from))
}

test('SPEC[ablation-002] three-state constraints hold over all nine combinations for both edge kinds', () => {
  const modes = ['ablated', 'borrowed', 'active']
  for (const kind of ['station-order', 'borrow']) {
    for (const from of modes) {
      for (const to of modes) {
        const found = law.validateModes([{ from: 'p', to: 't', kind }], { p: from, t: to })
        if (allowed(kind, from, to)) assert.equal(found, null, `${kind} ${from}->${to}`)
        else {
          assert.equal(found.kind, 'DagViolation')
          assert.equal(found.reason, kind === 'station-order'
            ? 'station-order: t requires p at least borrowed before active downstream'
            : 'borrow: t requires p at least borrowed')
        }
      }
    }
  }
})

test('SPEC[ablation-002] nodes missing from the modes count as ablated', () => {
  assert.equal(law.validateModes([{ from: 'p', to: 't' }], { t: 'active' }).reason,
    'station-order: t requires p at least borrowed before active downstream')
  assert.equal(law.validateModes([{ from: 'p', to: 't' }], {}), null)
})
