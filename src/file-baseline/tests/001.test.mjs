import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import { FileBaseline } from '../../../dist/file-baseline/FileBaseline.js'

const ok = value => ({ ok: true, value })
const error = error => ({ ok: false, error })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
function fixture(t, overrides = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'wanxiangli-file-baseline-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const values = new Map()
  const calls = []
  const payloads = {
    async read(reference) { calls.push(['read', reference]); return ok(values.get(reference) ?? null) },
    async write(bytes) { const reference = 'payload:' + hash(bytes); calls.push(['write', reference]); values.set(reference, Uint8Array.from(bytes)); return ok(reference) },
    ...overrides,
  }
  const resolvePath = input => path.resolve(root, input)
  const baseline = new FileBaseline({ resolvePath, payloads })
  return { root, values, calls, payloads, baseline, resolvePath }
}
test('capture 去重/ordinal排序并保留规范字段、键序与 UTF-8 摘要', async t => {
  const { root, baseline, calls } = fixture(t)
  fs.writeFileSync(path.join(root, 'a'), 'abc')
  const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  const reference = 'payload:' + digest
  assert.deepEqual(await baseline.capture(['z', 'a', 'a']), ok(`{"a":{"kind":"Present","payloadRef":"${reference}","payload_ref":"${reference}","sha256":"${digest}","contentHash":"${digest}"},"z":{"kind":"Missing"}}`))
  assert.equal(calls.length, 1)
  assert.deepEqual(await baseline.capture([]), ok('{}'))
})

test('编码沿用普通对象赋值的整数键与 __proto__ 行为', async t => {
  const { baseline } = fixture(t)
  assert.deepEqual(await baseline.capture(['10', '2', 'a']), ok('{"2":{"kind":"Missing"},"10":{"kind":"Missing"},"a":{"kind":"Missing"}}'))
  assert.deepEqual(await baseline.capture(['__proto__']), ok('{}'))
  assert.deepEqual(await baseline.capture(['constructor']), ok('{"constructor":{"kind":"Missing"}}'))
})

test('BOM/CRLF/尾换行与绝对路径按原字节保存，无变化仍写目标 payload', async t => {
  const { root, baseline, values, calls } = fixture(t)
  const bytes = Buffer.from('\ufeff中文\r\nlast\n', 'utf8')
  const absolute = path.join(root, 'file')
  fs.writeFileSync(absolute, bytes)
  const captured = await baseline.capture([absolute])
  assert.equal(captured.ok, true)
  const entry = JSON.parse(captured.value)[absolute]
  assert.deepEqual([...values.get(entry.payloadRef)], [...bytes])
  const compared = await baseline.compare([absolute], captured.value)
  assert.equal(compared.ok, true)
  assert.equal(compared.value.diffSummary, '')
  assert.equal(compared.value.refresh, false)
  assert.equal(compared.value.targetState, captured.value)
  assert.equal(calls.filter(call => call[0] === 'write').length, 2)
})

test('每个目标只读一次，同份字节形成 diff 与 targetState，即使写 payload 时文件再次改变', async t => {
  const { root, baseline, values, payloads } = fixture(t)
  const file = path.join(root, 'file')
  fs.writeFileSync(file, 'before\n')
  const captured = await baseline.capture(['file'])
  fs.writeFileSync(file, 'target\n')
  const originalRead = fs.readFileSync
  const originalWrite = payloads.write
  let reads = 0
  fs.readFileSync = function (candidate, ...rest) { if (candidate === file) reads++; return originalRead.call(this, candidate, ...rest) }
  syncBuiltinESMExports()
  payloads.write = async function (bytes) { fs.writeFileSync(file, 'later\n'); return originalWrite.call(this, bytes) }
  let compared
  try { compared = await baseline.compare(['file'], captured.value) }
  finally { fs.readFileSync = originalRead; syncBuiltinESMExports(); payloads.write = originalWrite }
  assert.equal(compared.ok, true)
  assert.equal(reads, 1)
  assert.match(compared.value.diffSummary, /-before\n\+target\n/)
  assert.doesNotMatch(compared.value.diffSummary, /later/)
  const reference = JSON.parse(compared.value.targetState).file.payloadRef
  assert.equal(Buffer.from(values.get(reference)).toString('utf8'), 'target\n')
  assert.equal(fs.readFileSync(file, 'utf8'), 'later\n')
})

test('只有 ENOENT 是 Missing，目录/权限/非法 UTF-8 失败且可能已有部分 payload', async t => {
  const { root, baseline, calls } = fixture(t)
  fs.writeFileSync(path.join(root, 'a'), 'already saved')
  fs.mkdirSync(path.join(root, 'b'))
  const partial = await baseline.capture(['b', 'a'])
  assert.equal(partial.ok, false)
  assert.match(partial.error, /^failed to read file b:/)
  assert.equal(calls.length, 1)
  fs.writeFileSync(path.join(root, 'bad'), Buffer.from([0xc3, 0x28]))
  assert.deepEqual(await baseline.capture(['bad']), error('failed to read file bad: invalid UTF-8'))
  const original = fs.readFileSync
  fs.readFileSync = () => { throw Object.assign(new Error('blocked'), { code: 'EACCES' }) }
  syncBuiltinESMExports()
  try { assert.deepEqual(await baseline.capture(['denied']), error('failed to read file denied: blocked')) }
  finally { fs.readFileSync = original; syncBuiltinESMExports() }
})

test('resolvePath 在读取 catch 外，带 ENOENT 的解析错误也原样拒绝', async t => {
  const { payloads } = fixture(t)
  const cause = Object.assign(new Error('resolve failure'), { code: 'ENOENT' })
  const baseline = new FileBaseline({ payloads, resolvePath() { throw cause } })
  await assert.rejects(baseline.capture(['file']), actual => actual === cause)
  await assert.rejects(baseline.compare(['file'], '{"file":{"kind":"Missing"}}'), actual => actual === cause)
})

test('payload Result 字符串和回调拒绝保持既有边界', async t => {
  const { root, payloads, baseline } = fixture(t)
  fs.writeFileSync(path.join(root, 'file'), 'data')
  payloads.write = async () => error('write failed\n')
  assert.deepEqual(await baseline.capture(['file']), error('failed to write payload for file: write failed\n'))
  const stored = JSON.stringify({ file: { kind: 'Present', sha256: 'hash', payloadRef: 'ref' } })
  payloads.read = async () => error('raw read failed\n')
  assert.deepEqual(await baseline.compare(['file'], stored), error('raw read failed\n'))
  const cause = new Error('payload rejected')
  for (const throws of [false, true]) {
    const fail = () => { if (throws) throw cause; return Promise.reject(cause) }
    payloads.write = fail
    await assert.rejects(baseline.capture(['file']), actual => actual === cause)
    payloads.read = fail
    await assert.rejects(baseline.compare(['file'], stored), actual => actual === cause)
  }
})

test('Missing 新增/Present 删除产生真实 diff，相关路径集合必须相等', async t => {
  const { root, baseline } = fixture(t)
  const missing = await baseline.capture(['file'])
  fs.writeFileSync(path.join(root, 'file'), 'added\n')
  const added = await baseline.compare(['file', 'file'], missing.value)
  assert.equal(added.ok, true)
  assert.match(added.value.diffSummary, /new file/)
  fs.unlinkSync(path.join(root, 'file'))
  const deleted = await baseline.compare(['file'], added.value.targetState)
  assert.equal(deleted.ok, true)
  assert.match(deleted.value.diffSummary, /deleted file/)
  assert.deepEqual(await baseline.compare(['other'], missing.value), error('maintenance baseline does not cover the related paths'))
})

test('缺旧 payload/坏摘要/非法旧字节不得伪装成删除', async t => {
  const { baseline, payloads } = fixture(t)
  const stored = JSON.stringify({ file: { kind: 'Present', sha256: 'hash', payloadRef: 'ref' } })
  assert.deepEqual(await baseline.compare(['file'], stored), error('missing baseline payload for file'))
  payloads.read = async () => ok(Uint8Array.from([0xc3, 0x28]))
  assert.deepEqual(await baseline.compare(['file'], stored), error('failed to read file file: invalid UTF-8'))
  payloads.read = async () => ok(new TextEncoder().encode('valid'))
  assert.deepEqual(await baseline.compare(['file'], stored), error('baseline payload digest mismatch for file'))
})

test('小 codec 保留 Thoth 根/entry/字段/unknown kind 的原错误文字与顺序', async t => {
  const { baseline } = fixture(t)
  const prefix = 'invalid maintenance baseline: '
  const pretty = value => JSON.stringify(value, null, 4)
  for (const root of [null, [], false, 7, 'text']) {
    assert.deepEqual(await baseline.compare([], JSON.stringify(root)), error(prefix + 'Error at: `$`\nExpecting an object but instead got: ' + pretty(root)))
  }
  for (const entry of [null, [], true, 0, 'text']) {
    assert.deepEqual(await baseline.compare(['p'], JSON.stringify({ p: entry })), error(prefix + 'Error at: `$`\nExpecting an object but instead got:\n' + pretty(entry)))
  }
  for (const [entry, field] of [[{}, 'kind'], [{ kind: 'Present' }, 'sha256'], [{ kind: 'Present', sha256: 'h', payload_ref: 'alias' }, 'payloadRef']]) {
    assert.deepEqual(await baseline.compare(['p'], JSON.stringify({ p: entry })), error(prefix + `Error at: \`$\`\nExpecting an object with a field named \`${field}\` but instead got:\n` + pretty(entry)))
  }
  for (const [entry, field, value] of [
    [{ kind: null }, 'kind', null], [{ kind: 'Present', sha256: 0, payloadRef: 7 }, 'sha256', 0],
    [{ kind: 'Present', sha256: 'h', payloadRef: [] }, 'payloadRef', []],
  ]) {
    assert.deepEqual(await baseline.compare(['p'], JSON.stringify({ p: entry })), error(prefix + `Error at: \`$.${field}\`\nExpecting a string but instead got: ` + pretty(value)))
  }
  assert.deepEqual(await baseline.compare(['p'], '{"p":{"kind":"Other"}}'), error(prefix + 'Error at: `$`\nThe following `failure` occurred with the decoder: unknown file state Other'))
  let syntax
  try { JSON.parse('{') } catch (cause) { syntax = cause.message }
  assert.deepEqual(await baseline.compare([], '{'), error(prefix + 'Given an invalid JSON: ' + syntax))
})

test('解码只读 canonical 字段，Missing 忽略额外值且 Present 允许空串', async t => {
  const { baseline, payloads, calls } = fixture(t)
  const missing = '{"p":{"kind":"Missing","sha256":7,"payloadRef":false}}'
  assert.deepEqual(await baseline.compare(['p'], missing), ok({ diffSummary: '', refresh: false, targetState: '{"p":{"kind":"Missing"}}' }))
  payloads.read = async reference => { calls.push(['read', reference]); return ok(new Uint8Array()) }
  assert.deepEqual(await baseline.compare(['p'], '{"p":{"kind":"Present","sha256":"","payloadRef":""}}'), error('baseline payload digest mismatch for p'))
  assert.deepEqual(calls.at(-1), ['read', ''])
})
