import assert from 'node:assert/strict'
import { classify } from 'wanxiangli/response-text'

const cases = [
  [null, 'Empty'],
  ['', 'Empty'],
  ['\t\r\n\ufeff\u2028', 'Empty'],
  ['\u0085', 'Text'],
  ['\u200b', 'Text'],
  ['普通正文。', 'Text'],
  ['List<string>', 'Text'],
  ['<em>text</em>', 'Text'],
  ['<call_x>', 'Text'],
  ['<callK>', 'Text'],
  ['<call-x>', 'ToolMarkup'],
  ['<callé>', 'ToolMarkup'],
  ['<uſe_tool>', 'ToolMarkup'],
  ['prefix <INVOKE name="tool"', 'ToolMarkup'],
  ['body </function_call> suffix', 'ToolMarkup'],
]
for (let count = 0; count < 10; count++) {
  for (const [text, expected] of cases) assert.equal(classify(text), expected, JSON.stringify(text))
}
console.log('response-text consumer passed')
