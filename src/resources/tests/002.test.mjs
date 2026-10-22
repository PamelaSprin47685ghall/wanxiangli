import test from 'node:test'
import assert from 'node:assert/strict'
import { Resources } from '../../../dist/resources/Resources.js'
import { Fixture } from './support/fixture.mjs'

test('SPEC[resources-002] missing substitutions and leftover placeholders fail closed', () => {
  const fixture = new Fixture()
  try {
    fixture.write('tool/demo', 'en.md', '{{byname}} carries {{charge}}.')
    fixture.write('tool/demo', 'zh-CN.md', '{{charge}} 交给 {{byname}}。')
    const resources = new Resources(fixture.root)
    assert.equal(resources.render('English', 'tool/demo', { byname: 'engineer', charge: 'delivery' }), 'engineer carries delivery.')
    assert.equal(resources.render('zh-CN', 'tool/demo', { byname: 'engineer', charge: 'delivery' }), 'delivery 交给 engineer。')

    // 缺替换值须报错，且不得输出含未展开占位符的残缺散文。
    fixture.write('tool/missing', 'en.md', '{{byname}} only.')
    fixture.write('tool/missing', 'zh-CN.md', '{{byname}} 唯一。')
    assert.throws(() => resources.render('English', 'tool/missing', {}), /missing substitution/)
    assert.throws(() => resources.render('SimplifiedChinese', 'tool/missing', {}), /missing substitution/)
  } finally {
    fixture.dispose()
  }
})
