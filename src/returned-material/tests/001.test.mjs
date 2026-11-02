import test from 'node:test'
import assert from 'node:assert/strict'
import { encode, body, carry, validationError, entries, fullText } from '../../../dist/returned-material/ReturnedMaterial.js'

const shapeError = 'returned material must be a canonical { body: string[], carry: string[] } JSON object'
const encodingError = 'returned material must use the canonical JSON object encoding'

test('规范字节固定键序，保留原文、空串、重复与块顺序', () => {
  const report = ['report\r\nline', 'quote " and \\', '中文 😀', '', 'same', 'same']
  const material = ['artifact\rline', '']
  const expected = '{"body":["report\\r\\nline","quote \\" and \\\\","中文 😀","","same","same"],"carry":["artifact\\rline",""]}'
  const encoded = encode(report, material)
  assert.equal(encoded, expected)
  assert.equal(encode([], []), '{"body":[],"carry":[]}')
  assert.deepEqual(body(encoded), report)
  assert.deepEqual(carry(encoded), material)
  assert.equal(validationError(expected), null)
  report[0] = 'changed'
  material.push('extra')
  assert.equal(encoded, expected)
})

test('分部读取只检查被读取字段，不要求另一字段或完整规范编码', () => {
  assert.deepEqual(body('{"body":["report"],"carry":42}'), ['report'])
  assert.deepEqual(carry('{"body":false,"carry":["artifact"]}'), ['artifact'])
  assert.deepEqual(body('{"body":[]}'), [])
  assert.deepEqual(carry('{"carry":[]}'), [])
  assert.deepEqual(body(' { "body": ["report"], "extra": true } '), ['report'])
  assert.deepEqual(entries('{"body":42,"carry":["artifact"]}'), [{ text: 'artifact' }])
})

test('显式 null 返回空数组，缺字段 undefined 抛原协议错误', () => {
  assert.deepEqual(body('{"body":null}'), [])
  assert.deepEqual(carry('{"carry":null}'), [])
  assert.throws(() => body('{"carry":[]}'), { message: "returned material body must be a JSON string array (Parameter 'encoded')" })
  assert.throws(() => carry('{"body":[]}'), { message: "returned material carry must be a JSON string array (Parameter 'encoded')" })
  assert.equal(validationError('{"body":null,"carry":[]}'), encodingError)
  assert.equal(validationError('{"body":[],"carry":null}'), shapeError)
  assert.equal(fullText('{"body":null,"carry":null}'), '')
})

test('字段不是字符串数组时拒绝，不把无效内容变为空材料', () => {
  for (const value of ['42', 'false', '"text"', '{}']) {
    assert.throws(() => body(`{"body":${value},"carry":[]}`), /returned material body must be a JSON string array/)
    assert.throws(() => carry(`{"body":[],"carry":${value}}`), /returned material carry must be a JSON string array/)
  }
  for (const value of ['[null]', '[1]', '[true]', '[{}]', '[["nested"]]', '["ok",null]']) {
    const invalidBody = `{"body":${value},"carry":[]}`
    const invalidCarry = `{"body":[],"carry":${value}}`
    assert.throws(() => body(invalidBody), { message: "returned material body must contain only strings (Parameter 'encoded')" })
    assert.throws(() => carry(invalidCarry), { message: "returned material carry must contain only strings (Parameter 'encoded')" })
    assert.equal(validationError(invalidBody), shapeError)
    assert.equal(validationError(invalidCarry), shapeError)
  }
})

test('非法 JSON 读取抛错，校验返回形状错误而不泄漏解析器文案', () => {
  for (const encoded of ['', 'not-json', '{"body":', '{"body":[],}']) {
    assert.throws(() => body(encoded))
    assert.throws(() => carry(encoded))
    assert.throws(() => entries(encoded))
    assert.throws(() => fullText(encoded))
    assert.equal(validationError(encoded), shapeError)
  }
})

test('非对象和数组根保留原拒绝路径', () => {
  for (const encoded of ['null', '[]', '["report"]', '42', 'false', '"report"']) {
    assert.throws(() => body(encoded), { message: "returned material must be a JSON object (Parameter 'encoded')" })
    assert.throws(() => carry(encoded), { message: "returned material must be a JSON object (Parameter 'encoded')" })
    assert.equal(validationError(encoded), shapeError)
  }
  assert.equal(validationError('{}'), shapeError)
  assert.equal(validationError('{"body":[]}'), shapeError)
  assert.equal(validationError('{"carry":[]}'), shapeError)
})

test('完整校验比较规范字节，拒绝键序、额外键、空白和等价转义', () => {
  const nonCanonical = [
    '{"carry":[],"body":[]}',
    '{"body":[],"carry":[],"extra":true}',
    ' {"body":[],"carry":[]}',
    '{"body":[],"carry":[]}\r\n',
    '{ "body": [], "carry": [] }',
    String.raw`{"body":["\u4e2d"],"carry":[]}`,
    String.raw`{"body":["a\/b"],"carry":[]}`,
    String.raw`{"body":["\u000a"],"carry":[]}`,
    '{"body":["discarded"],"body":[],"carry":[]}',
  ]
  for (const encoded of nonCanonical) assert.equal(validationError(encoded), encodingError, encoded)
  for (const encoded of ['{"body":[],"carry":[]}', '{"body":["中","a/b"],"carry":["","same","same"]}', String.raw`{"body":["\n"],"carry":[]}`]) {
    assert.equal(validationError(encoded), null, encoded)
  }
})

test('entries 保留 carry 原序和重复，返回的新数组和对象互不别名', () => {
  const encoded = '{"body":["report"],"carry":["same","same",""]}'
  const expected = [{ text: 'same' }, { text: 'same' }, { text: '' }]
  const result = entries(encoded)
  assert.deepEqual(result, expected)
  result[0].text = 'changed'
  result.push({ text: 'extra' })
  assert.deepEqual(entries(encoded), expected)
  const reports = body(encoded)
  reports[0] = 'changed'
  assert.deepEqual(body(encoded), ['report'])
  const materials = carry(encoded)
  materials.length = 0
  assert.deepEqual(carry(encoded), ['same', 'same', ''])
  assert.deepEqual(entries('{"carry":null}'), [])
})

test('fullText 只连接 body 后接 carry 的原块，不渲染注释或表格', () => {
  const encoded = '{"body":["report",""],"carry":["artifact","last\\rline"]}'
  assert.equal(fullText(encoded), 'report\n\n\n\nartifact\n\nlast\rline')
  assert.equal(fullText('{"body":[],"carry":[]}'), '')
  assert.equal(fullText('{"body":["# original"],"carry":["[raw]\\r\\nvalue"]}'), '# original\n\n[raw]\r\nvalue')
})
