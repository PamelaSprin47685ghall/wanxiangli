import test from 'node:test'
import assert from 'node:assert/strict'
import { Grounding, workspace, write } from './support.mjs'

test('SPEC[grounding-002] package self directory is always covered', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# alpha')
  assert.deepEqual(Grounding.resolve(root, 'requirements/alpha/WHAT.md'), ['alpha'])
  assert.deepEqual(Grounding.resolve(root, 'requirements/alpha/tests/001.test.mjs'), ['alpha'])
})

test('SPEC[grounding-002] APPLIES-TO external rules include and later exclude, in declaration order', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# alpha')
  write(root, 'requirements/alpha/APPLIES-TO', ['src/docs/**', '!src/docs/secret.md'].join('\n'))
  assert.deepEqual(Grounding.resolve(root, 'src/docs/guide.md'), ['alpha'])
  assert.deepEqual(Grounding.resolve(root, 'src/docs/secret.md'), [])
  assert.deepEqual(Grounding.resolve(root, 'src/other/guide.md'), [])
})

test('SPEC[grounding-002] overlapping paths return all matching packages sorted by name', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# alpha')
  write(root, 'requirements/beta/WHAT.md', '# beta')
  write(root, 'requirements/alpha/APPLIES-TO', 'shared/**')
  write(root, 'requirements/beta/APPLIES-TO', 'shared/**')
  assert.deepEqual(Grounding.resolve(root, 'shared/rules.md'), ['alpha', 'beta'])
})

test('SPEC[grounding-002] a path outside the workspace resolves to nothing', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# alpha')
  assert.deepEqual(Grounding.resolve(root, '../outside/file.md'), [])
})
