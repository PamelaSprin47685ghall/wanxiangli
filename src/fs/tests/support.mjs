import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Filesystem } from 'wanxiangli/fs'

export function workspace(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wxli-fs-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

export function fs(root) {
  return Filesystem({ root })
}

export function write(root, relative, content) {
  const target = path.join(root, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
  return target
}

export function linkOutside(t, root, relative) {
  const outside = mkdtempSync(path.join(tmpdir(), 'wxli-fs-out-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  const target = path.join(root, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  symlinkSync(outside, target)
  return outside
}

export function isOk(value) {
  return value !== null && typeof value === 'object' && value.ok === true
}
