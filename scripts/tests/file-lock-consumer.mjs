import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { acquire, isAcquireTimeout } from 'wanxiangli/file-lock'

const require = createRequire(import.meta.resolve('wanxiangli/file-lock'))
assert.equal(require('proper-lockfile/package.json').version, '4.1.2')
const lockRequire = createRequire(require.resolve('proper-lockfile'))
for (const dependency of ['graceful-fs', 'retry', 'signal-exit']) assert.ok(lockRequire.resolve(dependency))
const directory = fs.mkdtempSync(path.join(tmpdir(), 'wanxiangli-file-lock-consumer-'))
const target = path.join(directory, 'shared')
let held
try {
  held = await acquire(target, { kind: 'Retry', retries: 0, minTimeoutMs: 1, maxTimeoutMs: 1, factor: 1 })
  assert.equal(JSON.parse(fs.readFileSync(path.join(target + '.lock', 'owner.json'), 'utf8')).pid, process.pid)
  await assert.rejects(acquire(target, { kind: 'Budget', budgetMs: 1 }), error => {
    assert.ok(isAcquireTimeout(error))
    assert.equal(error.path, target)
    assert.ok(Number.isSafeInteger(error.attempts) && error.attempts >= 0)
    return true
  })
  await held.release()
  await held.release()
  held = undefined
  assert.equal(fs.existsSync(target + '.lock'), false)
  const next = await acquire(target, { kind: 'Budget', budgetMs: 100 })
  await next.release()
  assert.equal(fs.existsSync(target + '.lock'), false)
} finally {
  await held?.release()
  fs.rmSync(directory, { recursive: true, force: true })
}
console.log('file-lock consumer passed')
