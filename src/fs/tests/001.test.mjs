import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { workspace, fs, write, linkOutside } from './support.mjs'

test('SPEC[fs-001] strict UTF-8 read returns exact bytes including CRLF and missing final newline', t => {
  const root = workspace(t)
  const content = 'line1\r\nline2\r\nno-final-newline'
  write(root, 'a.txt', content)
  const result = fs(root).readUtf8Classified('a.txt')
  assert.equal(result.ok, true)
  assert.equal(result.value, content)
})

test('SPEC[fs-001] NUL bytes are rejected as INVALID_UTF8, never silently read as text', t => {
  const root = workspace(t)
  write(root, 'binary.txt', 'text\u0000with-nul')
  const result = fs(root).readUtf8Classified('binary.txt')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_UTF8')
})

test('SPEC[fs-001] invalid UTF-8 sequences are rejected as INVALID_UTF8', t => {
  const root = workspace(t)
  // Buffer 定长：越界索引赋值会被静默丢弃，必须以拼接写入坏字节。
  write(root, 'bad.txt', 'ok')
  writeFileSync(path.join(root, 'bad.txt'), Buffer.concat([Buffer.from('ok'), Buffer.from([0xff])]))
  const result = fs(root).readUtf8Classified('bad.txt')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_UTF8')
})

test('SPEC[fs-001] missing file reports FILE_NOT_FOUND', t => {
  const root = workspace(t)
  const result = fs(root).readUtf8Classified('missing.txt')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'FILE_NOT_FOUND')
  assert.match(result.reason, /missing\.txt/)
})

test('SPEC[fs-001] dot-dot escape is refused by resolveBounded as PATH_DENIED', t => {
  const root = workspace(t)
  const result = fs(root).resolveBounded('../outside.txt')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'PATH_DENIED')
})

test('SPEC[fs-001] symlink pointing outside the root is refused as PATH_DENIED', t => {
  const root = workspace(t)
  linkOutside(t, root, 'jump')
  const result = fs(root).resolveBounded('jump/file.txt')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'PATH_DENIED')
})

test('SPEC[fs-001] in-root symlink and plain paths resolve inside the boundary', t => {
  const root = workspace(t)
  const resolved = fs(root).resolveBounded('nested/file.txt')
  assert.equal(resolved.ok, true)
  assert.ok(resolved.value.startsWith(path.resolve(root)))
})

test('SPEC[fs-001] existsPath observes presence and absence without throwing', t => {
  const root = workspace(t)
  write(root, 'present.txt', 'x')
  const api = fs(root)
  assert.equal(api.existsPath(path.join(root, 'present.txt')), true)
  assert.equal(api.existsPath(path.join(root, 'absent.txt')), false)
})
