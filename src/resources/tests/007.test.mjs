import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Resources } from '../../../dist/resources/Resources.js'

test('SPEC[resources-007] the package root walk terminates with a clear error', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wanxiangli-no-package-'))
  try {
    assert.throws(
      () => Resources.packageRootFrom(directory),
      (error) => {
        assert.match(error.message, /package root not found/)
        return true
      }
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SPEC[resources-007] the constructor rejects a root without a resource tree', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wanxiangli-no-resources-'))
  try {
    assert.throws(() => new Resources(directory), /package resource root missing/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
