import test from 'node:test'
import assert from 'node:assert/strict'
import { chdir, cwd } from 'node:process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Resources } from '../../../dist/resources/Resources.js'

// The bundled module resolves its own package root from import.meta.url,
// independent of the process working directory.
const resources = new Resources()

test('SPEC[resources-003] package-internal location works from any working directory', () => {
  const here = cwd()
  const elsewhere = mkdtempSync(join(tmpdir(), 'wanxiangli-resources-cwd-'))
  try {
    chdir(elsewhere)
    resources.requireLanguagePair('library/resource-pair')
    const english = resources.readText('English', 'library/resource-pair')
    const chinese = resources.readText('zh-CN', 'library/resource-pair')
    assert.match(english, /Hello, \{\{name\}\}\./)
    assert.match(chinese, /\{\{name\}\}，你好。/)
    assert.ok(resources.resourceExists('provider'))
    assert.equal(resources.exists('SimplifiedChinese', 'library/resource-pair'), true)
    assert.equal(resources.exists('English', 'library/missing'), false)
  } finally {
    chdir(here)
    rmSync(elsewhere, { recursive: true, force: true })
  }
})

test('SPEC[resources-003] a resource absent from the package fails instead of reading elsewhere', () => {
  assert.throws(() => resources.readText('English', 'library/not-in-package'), /missing/)
  assert.throws(() => resources.requireLanguagePair('library/not-in-package'), /missing/)
})
