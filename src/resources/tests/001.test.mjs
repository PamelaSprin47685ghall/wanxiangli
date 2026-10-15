import test from 'node:test'
import assert from 'node:assert/strict'
import { Resources } from '../../../dist/resources/Resources.js'
import { Fixture } from './support/fixture.mjs'

test('SPEC[resources-001] a missing locale side fails closed for every language', () => {
  for (const [present, missing, presentLanguage] of [
    ['en.md', 'zh-CN.md', 'English'],
    ['zh-CN.md', 'en.md', 'zh-CN']
  ]) {
    const fixture = new Fixture()
    try {
      fixture.write('role/example', present, 'Present resource')
      const resources = new Resources(fixture.root)
      assert.throws(() => resources.requireLanguagePair('role/example'), /missing/)
      for (const language of ['English', 'SimplifiedChinese']) {
        assert.throws(() => resources.readText(language, 'role/example'), /missing/)
      }
      fixture.write('role/example', missing, 'Counterpart')
      resources.requireLanguagePair('role/example')
      // 先写的一侧保持原文；后补的对侧才是 Counterpart。
      assert.equal(resources.readText(presentLanguage, 'role/example'), 'Present resource')
    } finally {
      fixture.dispose()
    }
  }
})
