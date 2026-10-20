import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// SPEC[prefix-5] 独立：产物不导入任何兄弟库或宿主 SDK。
test('SPEC[prefix-5] the built prefix bundle imports no sibling library and no host SDK', () => {
  const bundle = readFileSync(fileURLToPath(new URL('../../../dist/prefix/Prefix.js', import.meta.url)), 'utf8')
  const imports = [...bundle.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map(m => m[1])
  assert.deepEqual(imports.filter(name => !name.startsWith('node:')), [])
  assert.doesNotMatch(bundle, /wanxiangli\/(trace|work|eventstore|durable-work)|@opencode|opencode-ai/)
})
