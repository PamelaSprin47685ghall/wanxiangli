import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('SPEC[build-007] source history must not add tarball dependencies', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0')
  assert.deepEqual(files.filter(file => /\.tgz$/i.test(file)), [])
})
