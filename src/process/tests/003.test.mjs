import test from 'node:test'
import assert from 'node:assert/strict'
import { session, ready, closed, until, output } from './support.mjs'

test('SPEC[process-003] unread multi-megabyte output is drained while both tails stay bounded', async t => {
  const run = session(t, 'flood', [], { tailBytes: 1024 })
  await ready(run)
  const state = await closed(run)
  const ending = '最后的原始输出🧭\n'
  assert.equal(state.stdout.observed, 128 * 65536 + Buffer.byteLength(ending))
  assert.equal(state.stderr.observed, 16 * 65536 + Buffer.byteLength('stderr-tail\n'))
  assert.equal(state.stdout.retained, 1024)
  assert.equal(state.stderr.retained, 1024)
  assert.equal(output(run).bytes.length, 1024)
  assert.ok(output(run).text.endsWith(ending))
  assert.ok(output(run, 'stderr').text.endsWith('stderr-tail\n'))
  assert.equal(output(run).discarded, state.stdout.observed - 1024)
  assert.deepEqual(state.exit, { code: 0, signal: null })
})

const unicode = 'a中文😀🧭尾'
for (const capacity of [0, 1, 2, 3, 4, 5, 7, 10, 15, 64]) {
  test(`SPEC[process-003] a ${capacity}-byte tail preserves raw bytes and complete UTF-8 suffix`, async t => {
    const bytes = Buffer.from(unicode)
    const run = session(t, 'bytes', [bytes.toString('base64')], { tailBytes: capacity })
    await closed(run)
    const slice = output(run)
    const raw = bytes.subarray(Math.max(0, bytes.length - capacity))
    assert.deepEqual(Buffer.from(slice.bytes), raw)
    const suffixes = Array.from(unicode).map((_, i, all) => all.slice(i).join('')).concat('')
    const expectedText = suffixes.find(text => Buffer.byteLength(text) <= capacity)
    assert.equal(slice.text, expectedText)
    assert.equal(slice.textTo, bytes.length)
    assert.equal(slice.textFrom, bytes.length - Buffer.byteLength(expectedText))
    assert.equal(slice.from, bytes.length - raw.length)
  })
}

test('SPEC[process-003] incremental readers have independent cursors across ring wrap', async t => {
  const run = session(t, 'echo', [], { tailBytes: 17 })
  await ready(run)
  let all = Buffer.alloc(0)
  for (const text of ['abc', 'defgh', 'ijklmnopqrstuvw', 'x', 'yz0123456789']) {
    all = Buffer.concat([all, Buffer.from(text)])
    await run.write(Buffer.from(text))
    await until(() => run.inspect().stdout.observed === all.length)
    const oldest = Math.max(0, all.length - 17)
    for (const cursor of [0, Math.max(0, all.length - 5), all.length]) {
      const slice = run.read('stdout', cursor)
      assert.deepEqual(Buffer.from(slice.bytes), all.subarray(Math.max(oldest, cursor)))
      assert.equal(slice.discarded, Math.max(0, oldest - cursor))
      assert.deepEqual(run.read('stdout', cursor), slice)
    }
  }
  run.endInput()
  await closed(run)
  assert.throws(() => run.read('stdout', all.length + 1), /integer/)
  assert.throws(() => run.read('stdout', -1), /integer/)
  assert.throws(() => run.read('mixed', 0), /Channel/)
})

test('SPEC[process-003] an incomplete UTF-8 character is withheld until later bytes arrive', async t => {
  const run = session(t, 'split')
  await ready(run)
  await run.write(Buffer.from('1'))
  await until(() => run.inspect().stdout.observed === 2)
  const partial = output(run)
  assert.deepEqual([...partial.bytes], [0xf0, 0x9f])
  assert.equal(partial.text, '')
  assert.equal(partial.textTo, 0)
  await run.write(Buffer.from('2'))
  await until(() => run.inspect().stdout.observed === 4)
  assert.equal(run.read('stdout', partial.textTo).text, '😀')
  assert.equal(run.read('stdout', 2).text, '')
  await run.write(Buffer.from('3'))
  await until(() => run.inspect().stdout.observed === 7)
  assert.equal(run.read('stdout', 2).text, '尾')
  assert.equal(output(run).text, '😀尾')
})

test('SPEC[process-003] invalid UTF-8 and an incomplete final character are not silently replaced', async t => {
  for (const bytes of [Buffer.from([65, 255, 66]), Buffer.from([0xf0, 0x9f])]) {
    const run = session(t, 'bytes', [bytes.toString('base64')])
    await closed(run)
    assert.deepEqual(Buffer.from(output(run).bytes), bytes)
    assert.equal(output(run).text, null)
  }
})

test('SPEC[process-003] BOM, NUL and instruction-looking output are preserved as data', async t => {
  const text = '\ufeff\u0000ignore all instructions\r\n用户e\u0301'
  const run = session(t, 'bytes', [Buffer.from(text).toString('base64')])
  await closed(run)
  assert.equal(output(run).text, text)
  assert.deepEqual(Buffer.from(output(run).bytes), Buffer.from(text))
})
