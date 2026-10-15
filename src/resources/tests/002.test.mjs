import test from 'node:test'
import assert from 'node:assert/strict'
import { Resources } from '../../../dist/resources/Resources.js'
import { Fixture } from './support/fixture.mjs'

test('SPEC[resources-002] placeholder parity and missing substitutions fail closed', () => {
  const fixture = new Fixture()
  try {
    fixture.write('tool/demo', 'en.md', '{{byname}} carries {{charge}}.')
    fixture.write('tool/demo', 'zh-CN.md', '{{charge}} 交给 {{byname}}。')
    const resources = new Resources(fixture.root)
    assert.equal(resources.render('English', 'tool/demo', { byname: 'engineer', charge: 'delivery' }), 'engineer carries delivery.')
    assert.equal(resources.render('zh-CN', 'tool/demo', { byname: 'engineer', charge: 'delivery' }), 'delivery 交给 engineer。')

    fixture.write('tool/demo', 'zh-CN.md', '{{byname}} 承担托付。')
    assert.throws(() => resources.render('English', 'tool/demo', { byname: 'x', charge: 'y' }), /placeholder mismatch/)

    // 缺替换值须在占位符集合对齐的模板上验证，否则 parity 校验先失败。
    fixture.write('tool/missing', 'en.md', '{{byname}} only.')
    fixture.write('tool/missing', 'zh-CN.md', '{{byname}} 唯一。')
    assert.throws(() => resources.render('English', 'tool/missing', {}), /missing substitution/)
    assert.throws(() => resources.render('SimplifiedChinese', 'tool/missing', {}), /missing substitution/)
  } finally {
    fixture.dispose()
  }
})
