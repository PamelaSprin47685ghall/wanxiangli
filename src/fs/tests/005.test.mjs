import test from 'node:test'
import assert from 'node:assert/strict'
import { workspace, fs } from './support.mjs'

test('SPEC[fs-005] matchesPathPattern keeps the git wildmatch semantics shared with requirement grounding', t => {
  const api = fs(workspace(t))
  assert.equal(api.matchesPathPattern('*.md', 'README.md').value, true)
  assert.equal(api.matchesPathPattern('*.md', 'docs/README.md').value, true)
  assert.equal(api.matchesPathPattern('/*.md', 'docs/README.md').value, false)
  assert.equal(api.matchesPathPattern('/*.md', 'README.md').value, true)
  assert.equal(api.matchesPathPattern('docs/*.md', 'docs/a.md').value, true)
  assert.equal(api.matchesPathPattern('docs/*.md', 'docs/sub/a.md').value, false)
  assert.equal(api.matchesPathPattern('docs/**/*.md', 'docs/sub/a.md').value, true)
  assert.equal(api.matchesPathPattern('a?c.md', 'abc.md').value, true)
  assert.equal(api.matchesPathPattern('a?c.md', 'ac.md').value, false)
  assert.equal(api.matchesPathPattern('[abc].md', 'b.md').value, true)
  assert.equal(api.matchesPathPattern('[abc].md', 'd.md').value, false)
})

test('SPEC[fs-005] negated character class and escaped literals behave as in gitignore', t => {
  const api = fs(workspace(t))
  assert.equal(api.matchesPathPattern('[!abc].md', 'd.md').value, true)
  assert.equal(api.matchesPathPattern('[!abc].md', 'a.md').value, false)
  assert.equal(api.matchesPathPattern('a.b.md', 'a.b.md').value, true)
  assert.equal(api.matchesPathPattern('a.b.md', 'axb.md').value, false)
})

test('SPEC[fs-005] empty pattern is refused with the stable invalid-pattern code', t => {
  const api = fs(workspace(t))
  assert.equal(api.matchesPathPattern('', 'x').code, 'INVALID_ANCHOR_PATTERN')
})

test('SPEC[fs-005] compilePattern result is consumable through testCompiled', t => {
  const api = fs(workspace(t))
  const compiled = api.compilePattern('*.ts')
  assert.equal(compiled.ok, true)
  assert.equal(api.testCompiled(compiled.value, 'src/main.ts'), true)
  assert.equal(api.testCompiled(compiled.value, 'src/main.js'), false)
})

test('SPEC[fs-005] every result uses the plain JS { ok, value | code, reason } shape', t => {
  const api = fs(workspace(t))
  const ok = api.readUtf8Classified('missing.txt')
  assert.equal(ok.ok, false)
  assert.equal(typeof ok.code, 'string')
  assert.equal(typeof ok.reason, 'string')
  const bounded = api.resolveBounded('../escape')
  assert.deepEqual(Object.keys(bounded).sort(), ['code', 'ok', 'reason'])
})
