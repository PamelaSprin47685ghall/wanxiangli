import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/// A temporary package root containing `resources/` with provider pairs.
export class Fixture {
  constructor() {
    this.root = mkdtempSync(join(tmpdir(), 'wanxiangli-resources-'))
    mkdirSync(join(this.root, 'resources', 'provider'), { recursive: true })
  }

  write(semanticPath, fileName, text) {
    const directory = join(this.root, 'resources', 'provider', semanticPath)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, fileName), text, 'utf8')
  }

  remove(semanticPath, fileName) {
    rmSync(join(this.root, 'resources', 'provider', semanticPath, fileName))
  }

  dispose() {
    rmSync(this.root, { recursive: true, force: true })
  }
}
