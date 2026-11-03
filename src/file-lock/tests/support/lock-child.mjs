import { createRequire } from 'node:module'
import { acquire } from '../../../../dist/file-lock/FileLock.js'

const require = createRequire(new URL('../../../../dist/file-lock/FileLock.js', import.meta.url))
const lockRequire = createRequire(require.resolve('proper-lockfile'))
const retry = lockRequire('retry')
const original = retry.operation
let reported = false
retry.operation = function (...args) {
  const operation = original.apply(this, args)
  const retryError = operation.retry
  operation.retry = function (error) {
    if (error?.code === 'ELOCKED' && !reported) { reported = true; process.send('contended') }
    return retryError.call(this, error)
  }
  return operation
}
const release = new Promise(resolve => process.on('message', message => { if (message === 'release') resolve() }))
const lease = await acquire(process.argv[2], { kind: 'Retry', retries: 100, minTimeoutMs: 1, maxTimeoutMs: 10, factor: 1.1 })
process.send('acquired')
await release
await lease.release()
process.send('released', () => process.disconnect())
