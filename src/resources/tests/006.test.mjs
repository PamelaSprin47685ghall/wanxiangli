import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { checkDistribution, declaredLanguages, placeholders } from './support/distribution.mjs'

const packageRoot = fileURLToPath(new URL('../../..', import.meta.url))
const shippedProviderRoot = join(packageRoot, 'resources', 'provider')

/// A temporary provider tree, so the failure cases never touch the shipped one.
function temporaryProviderRoot(entries) {
  const root = mkdtempSync(join(tmpdir(), 'wanxiangli-distribution-'))
  for (const [semanticPath, files] of Object.entries(entries)) {
    const directory = join(root, semanticPath)
    mkdirSync(directory, { recursive: true })
    for (const [fileName, text] of Object.entries(files)) {
      writeFileSync(join(directory, fileName), text, 'utf8')
    }
  }
  return root
}

test('DISTRIBUTION[resources-006] the shipped resource tree carries every declared language', () => {
  const problems = checkDistribution(shippedProviderRoot)
  assert.deepEqual(problems, [], `shipped provider tree is incomplete:\n${problems.join('\n')}`)
})

test('DISTRIBUTION[resources-006] a missing declared language leaf is reported', () => {
  const root = temporaryProviderRoot({
    'role/only-english': { 'en.md': 'Only English here.' }
  })
  try {
    const problems = checkDistribution(root)
    assert.equal(problems.length, 1)
    assert.match(problems[0], /missing declared language leaf: zh-CN/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('DISTRIBUTION[resources-006] an inconsistent placeholder set is reported', () => {
  const root = temporaryProviderRoot({
    'tool/mismatched': { 'en.md': '{{byname}} carries {{charge}}.', 'zh-CN.md': '{{byname}} 承担托付。' }
  })
  try {
    const problems = checkDistribution(root)
    assert.equal(problems.length, 1)
    assert.match(problems[0], /placeholder set mismatch/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('DISTRIBUTION[resources-006] a complete pair reports no problem', () => {
  const root = temporaryProviderRoot({
    'tool/complete': { 'en.md': '{{byname}} carries {{charge}}.', 'zh-CN.md': '{{charge}} 交给 {{byname}}。' }
  })
  try {
    assert.deepEqual(checkDistribution(root), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('DISTRIBUTION[resources-006] the declared languages are exactly the provider language leaves', () => {
  assert.deepEqual(declaredLanguages.map((language) => language.fileName), ['en.md', 'zh-CN.md'])
  assert.deepEqual(placeholders('{{a}} and {{b}} and {{a}}'), ['a', 'b'])
})
