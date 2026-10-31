import test from 'node:test'
import assert from 'node:assert/strict'
import { classify } from '../../../dist/response-text/ResponseText.js'

test('null、空串和现有 JS 空白集合归为 Empty', () => {
  const samples = [null, '', ' ', '\t\r\n', '\v\f', '\u00a0', '\u1680', '\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a', '\u2028\u2029', '\u202f', '\u205f', '\u3000', '\ufeff', ' \t\u00a0\ufeff\n']
  for (const text of samples) assert.equal(classify(text), 'Empty', JSON.stringify(text))
})

test('非 JS 空白字符不能被扩大成 Empty', () => {
  for (const text of ['\u0000', '\u0085', '\u180e', '\u200b', '\u001c\u001d\u001e\u001f', ' \u200b ']) {
    assert.equal(classify(text), 'Text', JSON.stringify(text))
  }
})

test('普通中英文、比较符和非工具标签归为 Text', () => {
  for (const text of ['检查完成。', 'The answer is 42.', 'a<b', 'x < y', 'List<string>', '<em>emphasis</em>', '<div>text</div>', '&lt;call&gt;', 'function_call without brackets']) {
    assert.equal(classify(text), 'Text', text)
  }
})

test('五类工具标签保留大小写、闭合、属性与不完整包含行为', () => {
  for (const tag of ['tool_call', 'use_tool', 'call', 'function_call', 'invoke']) {
    for (const text of [
      `<${tag}>value</${tag}>`,
      `<${tag.toUpperCase()}>`,
      `</${tag}>`,
      `<${tag}`,
      `<${tag} name="tool"`,
      `< ${tag} />`,
      `</ ${tag} >`,
      `<${tag}\nattribute="value">`,
      `ordinary prose <${tag}> ordinary prose`,
      `中文 <${tag} 结尾`,
    ]) assert.equal(classify(text), 'ToolMarkup', text)
  }
})

test('词边界保持当前 Unicode 和大小写规则', () => {
  for (const text of ['<call_x>', '<calls>', '<call1>', '<tool_calling>', '<function_calls>', '<invoked>']) {
    assert.equal(classify(text), 'Text', text)
  }
  for (const text of ['<call-x>', '<callé>', '<call\u0301>', '<call🙂>', '<CALL-x>', '<invoke:tool>', '<uſe_tool>']) {
    assert.equal(classify(text), 'ToolMarkup', text)
  }
  assert.equal(classify('<callK>'), 'Text')
})

test('连续及交错调用不被 Regex.lastIndex 污染', () => {
  for (let count = 0; count < 20; count++) {
    assert.equal(classify('<call>'), 'ToolMarkup')
    assert.equal(classify('<call>'), 'ToolMarkup')
    assert.equal(classify('ordinary'), 'Text')
    assert.equal(classify('  '), 'Empty')
    assert.equal(classify('prefix <invoke'), 'ToolMarkup')
    assert.equal(classify('List<string>'), 'Text')
  }
})
