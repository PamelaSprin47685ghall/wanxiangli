import test from 'node:test'
import assert from 'node:assert/strict'
import { Ablation, node, slice } from './support.mjs'

const law = Ablation()

test('SPEC[ablation-001] a well-formed manifest with slices has no node violation', () => {
  assert.equal(law.validateNodes([node('a'), node('b'), slice('a.x', 'a'), { id: 'c', package: 'c' }]), null)
})

test('SPEC[ablation-001] every package needs exactly one main node of its own name', () => {
  assert.deepEqual(law.validateNodes([{ id: 'a.x', package: 'a', kind: 'slice', parent: 'a.x' }]), {
    kind: 'InvalidManifest',
    reason: "Slice node 'a.x' parent 'a.x' must be kind 'package' but is 'slice'",
  })
  assert.deepEqual(law.validateNodes([{ id: 'other', package: 'a', kind: 'package' }]), {
    kind: 'InvalidManifest',
    reason: "Package 'a' is missing a main node (expected id 'a' and kind 'package')",
  })
  assert.deepEqual(law.validateNodes([node('a'), { id: 'a2', package: 'a', kind: 'package' }]), {
    kind: 'InvalidManifest',
    reason: "Package 'a' has multiple main nodes",
  })
})

test('SPEC[ablation-001] slice parents must exist, be a package node and share the package', () => {
  assert.equal(law.validateNodes([node('a'), { id: 's', package: 'a', kind: 'slice' }]).reason,
    "Slice node 's' must declare parent")
  assert.equal(law.validateNodes([node('a'), slice('s', 'a', 'ghost')]).reason,
    "Slice node 's' parent 'ghost' not found")
  assert.equal(law.validateNodes([node('a'), node('b'), slice('s', 'a', 'b')]).reason,
    "Slice node 's' (package 'a') and parent 'b' (package 'b') must belong to same package")
})

test('SPEC[ablation-001] slice violations are reported before main-node violations', () => {
  const found = law.validateNodes([{ id: 'x', package: 'p' }, { id: 's', package: 'q', kind: 'slice' }])
  assert.equal(found.reason, "Slice node 's' must declare parent")
})
