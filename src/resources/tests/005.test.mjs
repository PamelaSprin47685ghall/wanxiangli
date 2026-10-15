import test from 'node:test'
import assert from 'node:assert/strict'
import { Resources } from '../../../dist/resources/Resources.js'
import { Fixture } from './support/fixture.mjs'

test('SPEC[resources-004] language parsing and the preference ladder resolve without session binding', () => {
  const resources = new Resources()

  assert.equal(resources.parseLanguage('en'), 'English')
  assert.equal(resources.parseLanguage('zh-CN'), 'SimplifiedChinese')
  assert.equal(resources.tryParseLanguage('nope'), null)
  assert.throws(() => resources.parseLanguage('nope'), /unrecognized/)

  assert.deepEqual(resources.resolvePreference(null, null, null, null, null), { ok: true, value: 'English', error: '' })
  assert.deepEqual(resources.resolvePreference('zh-CN', null, 'en-US', 'en_US.UTF-8', 'en-US'), { ok: true, value: 'SimplifiedChinese', error: '' })
  assert.deepEqual(resources.resolvePreference(null, null, null, null, 'zh-CN'), { ok: true, value: 'SimplifiedChinese', error: '' })
  assert.deepEqual(resources.resolvePreference(null, 'en', 'zh-cn', 'zh_CN.UTF-8', 'zh-CN'), { ok: true, value: 'English', error: '' })
  assert.equal(resources.resolvePreference('klingon', null, null, null, null).ok, false)
})

test('SPEC[resources-004] the global preference switches on refresh and is not session-bound', () => {
  const resources = new Resources()

  assert.equal(resources.currentGlobalLanguage(), 'English')
  resources.refreshGlobalLanguage(() => 'zh-CN')
  assert.equal(resources.currentGlobalLanguage(), 'SimplifiedChinese')
  resources.refreshGlobalLanguage(() => 'English')
  assert.equal(resources.currentGlobalLanguage(), 'English')
  assert.throws(() => resources.refreshGlobalLanguage(() => 'klingon'), /unrecognized/)
})

test('SPEC[resources-004] protocol literals survive substitution untouched', () => {
  const fixture = new Fixture()
  try {
    fixture.write('tool/literal', 'en.md', 'Tool {{name}} uses field {{field}}.')
    fixture.write('tool/literal', 'zh-CN.md', '工具 {{name}} 使用字段 {{field}}。')
    const resources = new Resources(fixture.root)
    assert.equal(
      resources.render('English', 'tool/literal', { name: 'js-engineer', field: 'EDIT_NOT_FOUND' }),
      'Tool js-engineer uses field EDIT_NOT_FOUND.'
    )
  } finally {
    fixture.dispose()
  }
})

test('SPEC[resources-004] semantic paths reject escapes', () => {
  const resources = new Resources()
  assert.throws(() => resources.relativePath('English', '../escape'), /invalid/)
  assert.throws(() => resources.relativePath('English', '/absolute'), /invalid/)
  assert.throws(() => resources.relativePath('English', ''), /invalid/)
  assert.equal(resources.relativePath('English', 'role/manager'), 'provider/role/manager/en.md')
})
