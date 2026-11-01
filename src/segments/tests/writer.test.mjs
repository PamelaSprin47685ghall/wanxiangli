import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { SegmentedWriter } from 'wanxiangli/segments'

const durable = { ok: true, completion: 'durable' }
const empty = { ok: true, completion: 'no-append' }
function fixture(t, cap = 1000) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'wanxiangli-segmented-writer-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const directory = path.join(root, 'events')
  let calls = 0
  const provider = () => { calls++; return directory }
  const writer = new SegmentedWriter({ directory: provider, writerId: 'writer', segmentCap: cap })
  return { root, directory, writer, calls: () => calls, reset: () => { calls = 0 }, provider }
}
function patch(name, replacement, work) {
  const original = fs[name]
  fs[name] = replacement(original)
  try { return work() } finally { fs[name] = original }
}
function expectFault(result, kind, phase, cause) {
  assert.equal(result.ok, false)
  assert.equal(result.kind, kind)
  assert.equal(result.primary.phase, phase)
  assert.equal(result.primary.cause, cause)
  assert.deepEqual(result.cleanupFailures, [])
}

test('构造验证先 cap 后 writerId，不调用目录；身份只读', t => {
  let calls = 0
  const directory = () => { calls++; throw new Error('must not run') }
  assert.throws(() => new SegmentedWriter({ directory, writerId: '', segmentCap: 0 }), /segment cap must be positive/)
  for (const [writerId, text] of [[' ', /WriterId is required/], ['a\/b', /one path segment/], ['..', /one path segment/], ['a-0001', /hyphen and four digits/]]) {
    assert.throws(() => new SegmentedWriter({ directory, writerId, segmentCap: 1 }), text)
  }
  const writer = new SegmentedWriter({ directory, writerId: 'valid', segmentCap: 1 })
  assert.equal(writer.writerId, 'valid')
  assert.equal(calls, 0)
  assert.deepEqual(writer.append(''), empty)
  assert.equal(calls, 0)
  assert.throws(() => { writer.writerId = 'other' }, TypeError)
  assert.equal(Object.hasOwn(writer, 'CurrentFile'), false)
})

test('filePath 每次取目录；空追加不取目录，非空保留原取用次数', t => {
  const current = fixture(t, 10)
  assert.equal(current.calls(), 0)
  assert.equal(current.writer.filePath(), path.join(current.directory, 'writer-0000.ndjson'))
  assert.equal(current.writer.filePath(), path.join(current.directory, 'writer-0000.ndjson'))
  assert.equal(current.calls(), 2)
  current.reset()
  assert.deepEqual(current.writer.append(''), empty)
  assert.equal(current.calls(), 0)
  assert.equal(fs.existsSync(current.directory), false)
  assert.deepEqual(current.writer.append('a'), durable)
  assert.equal(current.calls(), 5)
  current.reset()
  assert.deepEqual(current.writer.append('b'), durable)
  assert.equal(current.calls(), 2)
  current.reset()
  assert.deepEqual(current.writer.append('long enough'), durable)
  assert.equal(current.calls(), 3)
})

test('UTF8 字节 cap：恰好上限不滚，超过后滚而保留旧字节', t => {
  const { directory, writer } = fixture(t, 6)
  assert.deepEqual(writer.append('é\n'), durable)
  assert.deepEqual(writer.append('é\n'), durable)
  assert.equal(fs.statSync(path.join(directory, 'writer-0000.ndjson')).size, 6)
  assert.deepEqual(writer.append('x\n'), durable)
  assert.equal(writer.filePath(), path.join(directory, 'writer-0001.ndjson'))
  assert.equal(fs.readFileSync(path.join(directory, 'writer-0000.ndjson'), 'utf8'), 'é\né\n')
  assert.equal(fs.readFileSync(writer.filePath(), 'utf8'), 'x\n')
})

test('空段接受超大 batch，下一次非空追加才滚', t => {
  const { directory, writer } = fixture(t, 3)
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, 'writer-0000.ndjson'), '')
  assert.deepEqual(writer.append('012345\n'), durable)
  assert.equal(writer.filePath(), path.join(directory, 'writer-0000.ndjson'))
  assert.deepEqual(writer.append('z\n'), durable)
  assert.equal(writer.filePath(), path.join(directory, 'writer-0001.ndjson'))
  assert.equal(fs.readFileSync(path.join(directory, 'writer-0000.ndjson'), 'utf8'), '012345\n')
})

test('缓存0000存在时不跳段；缓存缺失才从多段目录选最高', t => {
  const { directory, writer } = fixture(t)
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, 'writer-0000.ndjson'), 'zero\n')
  fs.writeFileSync(path.join(directory, 'writer-0003.ndjson'), 'three\n')
  fs.writeFileSync(path.join(directory, 'writer-0007.ndjson'), 'seven\n')
  assert.deepEqual(writer.append('first\n'), durable)
  assert.equal(fs.readFileSync(path.join(directory, 'writer-0000.ndjson'), 'utf8'), 'zero\nfirst\n')
  assert.equal(fs.readFileSync(path.join(directory, 'writer-0007.ndjson'), 'utf8'), 'seven\n')
  fs.unlinkSync(path.join(directory, 'writer-0000.ndjson'))
  assert.deepEqual(writer.append('second\n'), durable)
  assert.equal(writer.filePath(), path.join(directory, 'writer-0007.ndjson'))
  assert.equal(fs.readFileSync(writer.filePath(), 'utf8'), 'seven\nsecond\n')
})

test('legacy 不按 cap 滚动；旧目标消失后重新选择段系列', t => {
  const { directory, writer } = fixture(t, 100)
  fs.mkdirSync(directory)
  const legacy = path.join(directory, 'writer.ndjson')
  fs.writeFileSync(legacy, 'x'.repeat(150))
  assert.deepEqual(writer.append('legacy\n'), durable)
  assert.equal(writer.filePath(), legacy)
  fs.writeFileSync(path.join(directory, 'writer-0002.ndjson'), 'two\n')
  fs.writeFileSync(path.join(directory, 'writer-0005.ndjson'), 'five\n')
  fs.unlinkSync(legacy)
  assert.deepEqual(writer.append('new\n'), durable)
  assert.equal(writer.filePath(), path.join(directory, 'writer-0005.ndjson'))
  assert.equal(fs.existsSync(legacy), false)
})

test('滚段后 append 失败保持新 CurrentFile，不回滚旧状态', t => {
  const { directory, writer } = fixture(t, 1)
  assert.deepEqual(writer.append('a'), durable)
  const cause = new Error('append failed')
  const result = patch('appendFileSync', original => function (candidate, ...rest) {
    if (candidate === path.join(directory, 'writer-0001.ndjson')) throw cause
    return original.call(this, candidate, ...rest)
  }, () => writer.append('b'))
  expectFault(result, 'after-append', 'append', cause)
  assert.equal(writer.filePath(), path.join(directory, 'writer-0001.ndjson'))
  assert.equal(fs.existsSync(writer.filePath()), false)
  assert.equal(fs.readFileSync(path.join(directory, 'writer-0000.ndjson'), 'utf8'), 'a')
})

test('滚段后取目录失败也保留新 CurrentFile', t => {
  const { directory } = fixture(t)
  let fail = false
  let calls = 0
  const cause = new Error('changed directory policy')
  const writer = new SegmentedWriter({ writerId: 'writer', segmentCap: 1, directory() { calls++; if (fail && calls === 3) throw cause; return directory } })
  assert.deepEqual(writer.append('a'), durable)
  calls = 0; fail = true
  const result = writer.append('b')
  expectFault(result, 'before-append', 'before-append', cause)
  fail = false
  assert.equal(writer.filePath(), path.join(directory, 'writer-0001.ndjson'))
  assert.equal(fs.existsSync(writer.filePath()), false)
})

test('最高9999非空时耗尽拒绝，不生成五位段名', t => {
  const { directory, writer } = fixture(t, 1)
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, 'writer-9998.ndjson'), 'a')
  fs.writeFileSync(path.join(directory, 'writer-9999.ndjson'), 'b')
  const result = writer.append('c')
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'before-append')
  assert.equal(result.primary.phase, 'before-append')
  assert.match(result.primary.cause.message, /segment ordinal exhausted the four-digit space/)
  assert.equal(writer.filePath(), path.join(directory, 'writer-9999.ndjson'))
  assert.equal(fs.existsSync(path.join(directory, 'writer-10000.ndjson')), false)
  assert.equal(fs.readFileSync(writer.filePath(), 'utf8'), 'b')
})

test('目录能力改变后 filePath 原样抛，非空 append 为 before，空 append 不取路径', t => {
  const { directory } = fixture(t)
  let reject = false
  let calls = 0
  const cause = new Error('directory unavailable')
  const writer = new SegmentedWriter({ writerId: 'writer', segmentCap: 100, directory() { calls++; if (reject) throw cause; return directory } })
  assert.deepEqual(writer.append('first\n'), durable)
  const bytes = fs.readFileSync(writer.filePath())
  reject = true
  assert.throws(() => writer.filePath(), error => error === cause)
  expectFault(writer.append('next\n'), 'before-append', 'before-append', cause)
  const before = calls
  assert.deepEqual(writer.append(''), empty)
  assert.equal(calls, before)
  assert.deepEqual(fs.readFileSync(path.join(directory, 'writer-0000.ndjson')), bytes)
})

test('mkdir/readdir/stat 故障都是 before-append 且保持原 cause', t => {
  for (const method of ['mkdirSync', 'readdirSync', 'statSync']) {
    const { directory, writer } = fixture(t, 1)
    if (method === 'statSync') { fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'writer-0000.ndjson'), 'a') }
    const cause = Object.assign(new Error(method + ' failed'), { code: 'EIO' })
    const result = patch(method, () => () => { throw cause }, () => writer.append('b'))
    expectFault(result, 'before-append', 'before-append', cause)
  }
})

test('append 抛错无论实际未写/部分/全部写入都返回 after-append', t => {
  for (const extent of [0, 2, 4]) {
    const { directory, writer } = fixture(t)
    const cause = new Error('append unknown ' + extent)
    const result = patch('appendFileSync', original => function (candidate, text, encoding) {
      if (extent) original.call(this, candidate, text.slice(0, extent), encoding)
      throw cause
    }, () => writer.append('data'))
    expectFault(result, 'after-append', 'append', cause)
    const target = path.join(directory, 'writer-0000.ndjson')
    assert.equal(fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '', 'data'.slice(0, extent))
  }
})

test('open/fsync/close 与双失败保持原因身份、顺序及实际关闭', t => {
  for (const mode of ['open', 'fsync', 'close', 'both']) {
    const { directory, writer } = fixture(t)
    const causes = { open: new Error('open'), fsync: new Error('fsync'), close: new Error('close') }
    const original = { openSync: fs.openSync, fsyncSync: fs.fsyncSync, closeSync: fs.closeSync }
    const sequence = []
    let fd
    fs.openSync = function (candidate, flags, ...rest) {
      if (flags !== 'r+') return original.openSync.call(this, candidate, flags, ...rest)
      sequence.push('open')
      if (mode === 'open') throw causes.open
      fd = original.openSync.call(this, candidate, flags, ...rest)
      return fd
    }
    fs.fsyncSync = function (current) {
      if (current !== fd) return original.fsyncSync.call(this, current)
      sequence.push('fsync')
      if (mode === 'fsync' || mode === 'both') throw causes.fsync
      return original.fsyncSync.call(this, current)
    }
    fs.closeSync = function (current) {
      if (current !== fd) return original.closeSync.call(this, current)
      sequence.push('close')
      original.closeSync.call(this, current)
      if (mode === 'close' || mode === 'both') throw causes.close
    }
    let result
    try { result = writer.append('bytes\n') }
    finally { Object.assign(fs, original) }
    assert.equal(result.ok, false)
    assert.equal(result.kind, 'after-append')
    const primary = mode === 'both' ? 'fsync' : mode
    assert.equal(result.primary.phase, primary)
    assert.equal(result.primary.cause, causes[primary])
    assert.deepEqual(result.cleanupFailures, mode === 'both' ? [{ phase: 'close', cause: causes.close }] : [])
    assert.deepEqual(sequence, mode === 'open' ? ['open'] : ['open', 'fsync', 'close'])
    if (fd !== undefined) assert.throws(() => fs.fstatSync(fd), error => error.code === 'EBADF')
    assert.equal(fs.readFileSync(path.join(directory, 'writer-0000.ndjson'), 'utf8'), 'bytes\n')
  }
})

test('非 Error 原因也原样保留，不因 undefined 误判为成功', t => {
  const { writer } = fixture(t)
  const result = patch('appendFileSync', () => () => { throw undefined }, () => writer.append('x'))
  expectFault(result, 'after-append', 'append', undefined)
  assert.equal(Object.hasOwn(result.primary, 'cause'), true)
})
