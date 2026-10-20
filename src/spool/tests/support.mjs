import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export function directory(t) {
  const folder = mkdtempSync(path.join(tmpdir(), 'wanxiangli-spool-test-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  return folder
}

export const entries = folder => readdirSync(folder)

export function bytes(text) {
  return new TextEncoder().encode(text)
}

export function pattern(size, seed = 0) {
  const out = new Uint8Array(size)
  for (let i = 0; i < size; i++) out[i] = (i * 31 + seed) & 0xff
  return out
}
