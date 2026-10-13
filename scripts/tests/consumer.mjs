import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { Work } from 'wanxiangli/work'
import { SqliteJournal } from 'wanxiangli/eventstore'

const [runtime, mode, database, effectFile] = process.argv.slice(2)
assert.deepEqual(Object.keys(await import('wanxiangli/work')), ['Work'])
assert.deepEqual(Object.keys(await import('wanxiangli/eventstore')), ['SqliteJournal'])
await assert.rejects(import('wanxiangli/dist/lifecycle/Work.js'), {
  code: runtime === 'node' ? 'ERR_PACKAGE_PATH_NOT_EXPORTED' : 'ERR_MODULE_NOT_FOUND',
})
assert.ok(runtime === 'node' || runtime === 'bun')
const connection = runtime === 'node'
  ? new (await import('node:sqlite')).DatabaseSync(database)
  : new (await import('bun:sqlite')).Database(database)
const journal = new SqliteJournal(connection)
const work = new Work('consumer-work', journal)

function commit(requestId, command) {
  const reply = work.execute(requestId, command)
  assert.equal(reply.status, 'Committed', JSON.stringify(reply))
  return reply.result
}

function dispatch(reply) {
  if (reply.status !== 'Committed' || reply.result.kind !== 'DispatchExecution') return
  const effect = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { appendFileSync } from 'node:fs'
    const [file, operationId, digest, path] = process.argv.slice(1)
    appendFileSync(file, JSON.stringify({ operationId, digest, path, execSessionId: String(process.pid) }) + '\\n')
  `, effectFile, reply.result.operationId, reply.result.digest, reply.result.path], { encoding: 'utf8' })
  assert.ifError(effect.error)
  assert.equal(effect.status, 0, effect.stderr)
}

if (mode === 'start') {
  commit('open', { type: 'Open', root: '真实 npm 消费者', sequence: ['S1', 'S2', 'S3'], ownerId: 'manager', openingCursor: 0 })
  for (let stage = 1; stage <= 3; stage++) {
    commit(`review-${stage}`, { type: 'Review', incumbencyId: work.inspect().active.id, reviewerId: 'reviewer', findings: [] })
    if (stage < 3) commit(`relay-${stage}`, { type: 'Deliver', incumbencyId: work.inspect().active.id, providerRunId: 'run', toolCallId: `relay-call-${stage}`, cursor: stage * 10, blockers: [], nextOwnerId: 'manager' })
  }
  const command = { type: 'Deliver', incumbencyId: work.inspect().active.id, providerRunId: 'run', toolCallId: 'delivery-call', cursor: 100, blockers: [], draft: { digest: 'approved-digest', path: '/approved-plan' } }
  const reply = work.execute('reserve', command)
  dispatch(reply)
  assert.equal(readFileSync(effectFile, 'utf8').trim().split('\n').length, 1)
  console.log(JSON.stringify({ phase: 'effect-completed', operationId: reply.result.operationId }))
  // 故意不结算、不关闭数据库，由父测试在真实外部效果之后强杀。
  setInterval(() => {}, 1000)
} else {
  assert.equal(mode, 'recover')
  assert.equal(work.recover().next, 'ObserveExecution')
  const reserved = work.history().find(frame => frame.requestId === 'reserve').events[0]
  const command = { type: 'Deliver', incumbencyId: reserved.incumbencyId, providerRunId: 'run', toolCallId: 'delivery-call', cursor: 100, blockers: [], draft: { digest: 'approved-digest', path: '/approved-plan' } }
  const replay = work.execute('reserve', command)
  assert.equal(replay.result.kind, 'ObserveExecution')
  dispatch(replay)
  const effects = readFileSync(effectFile, 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(effects.length, 1)
  assert.equal(effects[0].operationId, reserved.operationId)
  commit('observe-accepted', { type: 'ResolveDelivery', outcome: 'Accepted', ...effects[0], blockers: [] })
  assert.equal(work.recover().next, 'Done')
  assert.equal(work.inspect().active, null)
  const before = journal.read('consumer-work')
  assert.deepEqual(new Work('consumer-work', journal).inspect(), work.inspect())
  assert.deepEqual(journal.read('consumer-work'), before)
  assert.equal(existsSync(new URL('./node_modules/wanxiangli/src/lifecycle/Work.fs', import.meta.url)), false)
  assert.equal(existsSync(new URL('./node_modules/@fable-org', import.meta.url)), false)
  const rounds = work.inspect().rounds.length
  journal.close()
  console.log(JSON.stringify({ done: true, externalEffects: effects.length, rounds }))
}
