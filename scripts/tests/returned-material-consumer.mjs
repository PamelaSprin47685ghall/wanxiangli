import assert from 'node:assert/strict'
import { encode, body, carry, validationError, entries, fullText } from 'wanxiangli/returned-material'

const expected = '{"body":["report\\r\\nline","quote \\" and \\\\","中文 😀",""],"carry":["artifact","artifact"]}'
const encoded = encode(['report\r\nline', 'quote " and \\', '中文 😀', ''], ['artifact', 'artifact'])
assert.equal(encoded, expected)
assert.equal(validationError(expected), null)
assert.deepEqual(body(encoded), ['report\r\nline', 'quote " and \\', '中文 😀', ''])
assert.deepEqual(carry(encoded), ['artifact', 'artifact'])
assert.deepEqual(entries(encoded), [{ text: 'artifact' }, { text: 'artifact' }])
assert.equal(fullText('{"body":["report",""],"carry":["artifact"]}'), 'report\n\n\n\nartifact')
assert.deepEqual(body('{"body":null,"carry":42}'), [])
assert.deepEqual(carry('{"body":42,"carry":["artifact"]}'), ['artifact'])
assert.throws(() => body('{"carry":[]}'), /returned material body must be a JSON string array/)
assert.throws(() => carry('{"body":[]}'), /returned material carry must be a JSON string array/)
assert.equal(validationError('{"body":null,"carry":[]}'), 'returned material must use the canonical JSON object encoding')
assert.equal(validationError('{"body":[],"carry":null}'), 'returned material must be a canonical { body: string[], carry: string[] } JSON object')
console.log('returned-material consumer passed')
