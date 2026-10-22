import test from 'node:test'
import assert from 'node:assert/strict'
import { Resources } from '../../../dist/resources/Resources.js'
import { Fixture } from './support/fixture.mjs'

test('SPEC[resources-001] a read validates only the selected language', () => {
  for (const [present, missing, presentLanguage] of [
    ['en.md', 'zh-CN.md', 'English'],
    ['zh-CN.md', 'en.md', 'zh-CN']
  ]) {
    const fixture = new Fixture()
    try {
      fixture.write('role/example', present, 'Present resource')
      const resources = new Resources(fixture.root)
      // 所选语种在位即可读取；另一语种缺失不影响本次读取。
      assert.equal(resources.readText(presentLanguage, 'role/example'), 'Present resource')
      // 所选语种缺失时明确报错，指名缺失的文件，且不回退到另一语种。
      assert.throws(
        () => resources.readText(missing === 'en.md' ? 'English' : 'SimplifiedChinese', 'role/example'),
        (error) => {
          assert.match(error.message, /package resource missing/)
          assert.match(error.message, new RegExp(missing.replace('.', '\\.')))
          return true
        }
      )
      fixture.write('role/example', missing, 'Counterpart')
      // 先写的一侧保持原文；后补的对侧才是 Counterpart。
      assert.equal(resources.readText(presentLanguage, 'role/example'), 'Present resource')
      assert.equal(
        resources.readText(missing === 'en.md' ? 'English' : 'SimplifiedChinese', 'role/example'),
        'Counterpart'
      )
    } finally {
      fixture.dispose()
    }
  }
})

test('SPEC[resources-001] render loads only the selected language template', () => {
  const fixture = new Fixture()
  try {
    fixture.write('tool/one-sided', 'en.md', '{{byname}} carries {{charge}}.')
    const resources = new Resources(fixture.root)
    assert.equal(
      resources.render('English', 'tool/one-sided', { byname: 'engineer', charge: 'delivery' }),
      'engineer carries delivery.'
    )
    assert.throws(() => resources.render('zh-CN', 'tool/one-sided', {}), /package resource missing/)
  } finally {
    fixture.dispose()
  }
})
