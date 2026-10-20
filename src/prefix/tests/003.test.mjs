import test from 'node:test'
import assert from 'node:assert/strict'
import { Prefix } from 'wanxiangli/prefix'

const prefix = new Prefix()

test('SPEC[prefix-4] a re-entered view checkpoint is the same fact, not a second checkpoint', () => {
  const once = prefix.appendCheckpoint([], 'call-1')
  const twice = prefix.appendCheckpoint(once, 'call-1')
  assert.deepEqual(twice, ['call-1'])
  assert.deepEqual(prefix.appendCheckpoint(twice, 'call-2'), ['call-1', 'call-2'], 'order of commitment is kept')
})

test('SPEC[prefix-4] appending returns a new frozen window and leaves the input untouched', () => {
  const input = ['call-1']
  const output = prefix.appendCheckpoint(input, 'call-2')
  assert.deepEqual(input, ['call-1'])
  assert.notEqual(output, input)
  assert.throws(() => { output.push('x') }, TypeError)
  assert.throws(() => prefix.appendCheckpoint(input, ''), TypeError)
})
