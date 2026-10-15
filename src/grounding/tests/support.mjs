import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Grounding } from 'wanxiangli/grounding'

export { Grounding }

export function workspace(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wxli-grounding-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

export function write(root, relative, content) {
  const target = path.join(root, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
  return target
}
