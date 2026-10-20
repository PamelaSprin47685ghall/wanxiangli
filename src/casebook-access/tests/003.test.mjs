import test from 'node:test'
import assert from 'node:assert/strict'

import { CasebookAccessLaw } from 'wanxiangli/casebook-access'

const law = new CasebookAccessLaw()

test('SPEC[casebook-access-1] reads and committed mutations count; both move endpoints count; discovery never counts', () => {
  for (const kind of ['read', 'create', 'edit', 'delete']) assert.deepEqual(law.accessPaths({ kind, path: 'a.txt' }), ['a.txt'])
  assert.deepEqual(law.accessPaths({ kind: 'move', source: 'old.txt', destination: 'new.txt' }), ['old.txt', 'new.txt'])
  assert.deepEqual(law.accessPaths({ kind: 'mutation', path: 'e.txt', committed: true }), ['e.txt'])
  assert.deepEqual(law.accessPaths({ kind: 'mutation', path: 'e.txt', committed: false }), [])
  for (const kind of ['grep', 'glob', 'list', 'stat', 'mention']) assert.deepEqual(law.accessPaths({ kind, path: 'x' }), [], kind)
  assert.deepEqual(law.accessPaths({ kind: 'read', path: '  \t' }), [])
  assert.throws(() => law.accessPaths({ kind: 'teleport', path: 'x' }))
  assert.throws(() => law.accessPaths({ kind: 'mutation', path: 'x' }), /committed/)
})

test('SPEC[casebook-access-2] tool results: only committed create/rewrite/delete/move contribute paths', () => {
  for (const tool of ['create', 'rewrite', 'delete']) {
    assert.deepEqual(law.toolPaths(tool, { path: 'p.txt' }, true), ['p.txt'])
    assert.deepEqual(law.toolPaths(tool, { filePath: 'f.txt' }, true), ['f.txt'])
    assert.deepEqual(law.toolPaths(tool, { file: 'g.txt' }, true), ['g.txt'])
    assert.deepEqual(law.toolPaths(tool, { path: 'p.txt' }, false), [])
  }
  assert.deepEqual(law.toolPaths('create', { path: '', filePath: 'later.txt' }, true), [], 'the first present key decides')
  assert.deepEqual(law.toolPaths('create', { path: { nested: 1 }, filePath: 'later.txt' }, true), [], 'a non-text path is no path')
  assert.deepEqual(law.toolPaths('create', { path: 7 }, true), ['7'])
  assert.deepEqual(law.toolPaths('create', null, true), [])
  assert.deepEqual(law.toolPaths('move', { source: 'a', destination: 'b' }, true), ['a', 'b'])
  assert.deepEqual(law.toolPaths('move', { source: 'a' }, true), [])
  assert.deepEqual(law.toolPaths('move', { source: 'a', destination: 'b' }, false), [])
  for (const tool of ['read', 'grep', 'glob', 'ls', 'fetch', '']) assert.deepEqual(law.toolPaths(tool, { path: 'x' }, true), [], tool)
  assert.equal(law.isSubstantiveTool('create'), true)
  assert.equal(law.isSubstantiveTool('rewrite'), true)
  assert.equal(law.isSubstantiveTool('delete'), false)
  assert.throws(() => law.toolPaths('create', { path: 'x' }, 'yes'))
})

test('SPEC[casebook-access-3] relatedPaths drops blanks, dedupes and sorts by code unit; fission lanes union through it', () => {
  assert.deepEqual(law.relatedPaths(['b', 'a', ' ', 'b', 'Z', 'é', '😀', 'a']), ['Z', 'a', 'b', 'é', '😀'])
  assert.deepEqual(law.relatedPaths([...['pre.txt', 'shared.txt'], ...['shared.txt', 'lane1.txt'], ...['lane2.txt']]), ['lane1.txt', 'lane2.txt', 'pre.txt', 'shared.txt'])
  assert.throws(() => law.relatedPaths('a'))
  assert.throws(() => law.relatedPaths([1]))
})

test('SPEC[casebook-access-4] executor single-file reads; command substitution and option values are never files', () => {
  const cases = [
    ['cat read.txt', 'read.txt'], ['cat -n read.txt', 'read.txt'], ['cat read.txt | grep x', 'read.txt'],
    ["cat 'with space.txt'", 'with space.txt'], ['head -n 5 h.txt', 'h.txt'], ['head -n5 h.txt', 'h.txt'],
    ['tail -n +5 t.txt', 't.txt'], ['tail -c 100 t.txt', 't.txt'], ['head -c 1K h.txt', 'h.txt'], ['tail -f log.txt', 'log.txt'],
    ['sed -n 1,5p s.txt', 's.txt'], ["sed -e 's/a/b/' s.txt", 's.txt'],
    ['cat $(ls)', null], ['cat `ls`', null], ['tail -n 5 `pick`', null], ['bash -c "cat x"', null], ['sh x', null],
    ['ls -la', null], ['', null], ['   ', null], ['sed only-script', null], ['cat', null],
  ]
  for (const [command, expected] of cases) assert.equal(law.execRead(command), expected, command)
  assert.throws(() => law.execRead(null))
})
