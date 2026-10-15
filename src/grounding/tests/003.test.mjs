import test from 'node:test'
import assert from 'node:assert/strict'
import { Grounding, workspace, write } from './support.mjs'

test('SPEC[grounding-003] materialize injects only direct root-level *.md files, sorted by name', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# what')
  write(root, 'requirements/alpha/B.md', 'b body')
  write(root, 'requirements/alpha/A.md', 'a body')
  write(root, 'requirements/alpha/tests/001.test.mjs', 'test source')
  write(root, 'requirements/alpha/APPLIES-TO', 'src/**')
  const snapshot = Grounding.materialize(root, 'alpha')
  // 主仓 requirement-grounding 006 的权威语义：包根全部 *.md（含 WHAT.md）进入材料，
  // 仅 tests/ 与 APPLIES-TO 排除。
  assert.deepEqual(snapshot.materials.map(m => m.path), [
    'requirements/alpha/A.md',
    'requirements/alpha/B.md',
    'requirements/alpha/WHAT.md'
  ])
  assert.equal(snapshot.materials[0].resultBytes, 'a body')
})

test('SPEC[grounding-003] snapshot digest is content-anchored over path and bytes', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# what')
  write(root, 'requirements/alpha/A.md', 'a body')
  const snapshot = Grounding.materialize(root, 'alpha')
  const expected = Grounding.sha256Hex(
    'requirements/alpha/A.md\u0000a body\u0000' + 'requirements/alpha/WHAT.md\u0000# what\u0000'
  )
  assert.equal(snapshot.digest, expected)
  const other = workspace(t)
  write(other, 'requirements/alpha/WHAT.md', '# what')
  write(other, 'requirements/alpha/A.md', 'different body')
  assert.notEqual(Grounding.materialize(other, 'alpha').digest, snapshot.digest)
})

test('SPEC[grounding-003] materialize of an unknown package fails explicitly', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# alpha')
  assert.throws(() => Grounding.materialize(root, 'missing'), /unknown requirement package/)
})

test('SPEC[grounding-003] sha256Hex matches the known lowercase hex vector', () => {
  assert.equal(
    Grounding.sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )
})

test('SPEC[grounding-003] snapshotsForPaths deduplicates packages and sorts by name', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# alpha')
  write(root, 'requirements/beta/WHAT.md', '# beta')
  write(root, 'requirements/alpha/APPLIES-TO', 'shared/**')
  write(root, 'requirements/beta/APPLIES-TO', 'shared/**')
  const snapshots = Grounding.snapshotsForPaths(root, [
    'shared/a.md',
    'shared/b.md',
    'requirements/beta/WHAT.md'
  ])
  assert.deepEqual(snapshots.map(s => s.packageName), ['alpha', 'beta'])
})
