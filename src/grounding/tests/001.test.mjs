import test from 'node:test'
import assert from 'node:assert/strict'
import { Grounding, workspace, write } from './support.mjs'

test('SPEC[grounding-001] discover finds requirements packages with WHAT.md, sorted by name', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# alpha')
  write(root, 'requirements/beta/WHAT.md', '# beta')
  write(root, 'requirements/no-what/OTHER.md', '# not a package')
  const packages = Grounding.discover(root)
  assert.deepEqual(packages.map(p => p.name), ['alpha', 'beta'])
})

test('SPEC[grounding-001] discover returns empty when requirements/ is missing', t => {
  const root = workspace(t)
  assert.deepEqual(Grounding.discover(root), [])
})

test('SPEC[grounding-001] discover loads APPLIES-TO rules and skips comments and blank lines', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# alpha')
  write(root, 'requirements/alpha/APPLIES-TO', [
    '# comment line',
    '',
    'src/docs/**',
    '!src/docs/ignored.md'
  ].join('\n'))
  const [alpha] = Grounding.discover(root)
  assert.deepEqual(alpha.rules, [
    { include: true, pattern: 'src/docs/**' },
    { include: false, pattern: 'src/docs/ignored.md' }
  ])
})

test('SPEC[grounding-001] APPLIES-TO declaring package self coverage is a configuration error', t => {
  const root = workspace(t)
  write(root, 'requirements/alpha/WHAT.md', '# alpha')
  write(root, 'requirements/alpha/APPLIES-TO', 'requirements/alpha/WHAT.md')
  assert.throws(() => Grounding.discover(root), /self coverage/)
})
