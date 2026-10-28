import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { Work } from 'wanxiangli/work'
import { DurableWork } from 'wanxiangli/durable-work'
import { SqliteJournal } from 'wanxiangli/eventstore'

const [runtime, mode, database, effectFile] = process.argv.slice(2)
assert.deepEqual(Object.keys(await import('wanxiangli/work')).sort(), [
  'PlanAskGate',
  'RootWorkspaceCell',
  'SharedAsyncJournalPool',
  'SharedEventStorePool',
  'Work',
  'abandonLocalState',
  'planAskGate',
  'rootWorkspaceCell',
  'sharedAsyncJournalPool',
  'sharedEventStorePool',
])
assert.deepEqual(Object.keys(await import('wanxiangli/eventstore')), ['SqliteJournal'])
assert.deepEqual(Object.keys(await import('wanxiangli/durable-work')), ['DurableWork'])
await assert.rejects(import('wanxiangli/dist/lifecycle/Work.js'), {
  code: runtime === 'node' ? 'ERR_PACKAGE_PATH_NOT_EXPORTED' : 'ERR_MODULE_NOT_FOUND',
})
assert.ok(runtime === 'node' || runtime === 'bun')
const connection = runtime === 'node'
  ? new (await import('node:sqlite')).DatabaseSync(database)
  : new (await import('bun:sqlite')).Database(database)
const journal = new SqliteJournal(connection)
const work = new DurableWork('consumer-work', journal)
assert.deepEqual(Object.keys(new Work('standalone')).sort(), ['execute', 'history', 'inspect', 'records', 'recover'])
assert.equal(work.journal, undefined)
assert.equal(journal.database, undefined)

function commit(requestId, command) {
  const reply = work.execute(requestId, command)
  assert.equal(reply.status, 'Committed', JSON.stringify(reply))
  return reply.result
}

function review(requestId, updates, extra = {}) {
  return commit(requestId, {
    type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: requestId, updates, ...extra,
  })
}

function confirm(effect, outcome, extra = {}) {
  commit(`confirm-${effect.id}-${outcome}`, { type: 'Confirm', effectId: effect.id, outcome, ...extra })
}

if (mode === 'start') {
  for (const milestone of ['理解与路径', '流程与伪代码', '待执行']) {
    review(`keep-${milestone}`, [{ key: 'item', value: 'keep' }])
    const relay = review(`clear-${milestone}`, [{ key: 'item', value: null }])
    assert.equal(relay.kind, 'Relayed')
    confirm(relay.effect, 'Sent')
    const advanced = review(`advance-${milestone}`, [])
    assert.equal(advanced.kind, 'Advanced')
    assert.equal(advanced.milestone, milestone)
    confirm(advanced.effect, 'Sent')
  }
  const reply = work.execute('reserve', {
    type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'delivery-call', updates: [], digest: 'approved-digest',
  })
  assert.equal(reply.status, 'Committed')
  assert.equal(reply.result.kind, 'Launched')
  const execSessionId = 'external-session-1'
  writeFileSync(effectFile, JSON.stringify({
    operationId: reply.result.operationId, digest: 'approved-digest', execSessionId,
  }) + '\n')
  confirm(reply.result.effect, 'SessionCreated', { execSessionId })
  assert.equal(readFileSync(effectFile, 'utf8').trim().split('\n').length, 1)
  console.log(JSON.stringify({ phase: 'effect-completed', operationId: reply.result.operationId }))
  setInterval(() => {}, 1000)
} else {
  assert.equal(mode, 'recover')
  const pending = work.recover()
  assert.equal(pending.effect.kind, 'Launch')
  assert.equal(pending.effect.phase, 'Send')
  assert.equal(pending.effect.execSessionId, 'external-session-1')
  const effects = readFileSync(effectFile, 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(effects.length, 1)
  assert.equal(effects[0].operationId, pending.effect.id)
  const replay = work.execute('reserve', {
    type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'delivery-call', updates: [], digest: 'approved-digest',
  })
  assert.equal(replay.status, 'Replayed')
  assert.equal(replay.result.operationId, effects[0].operationId)
  confirm(pending.effect, 'Admitted', { execSessionId: pending.effect.execSessionId })
  assert.equal(work.inspect().milestone, '待执行')
  assert.equal(work.recover().effect, null)
  const before = journal.read('consumer-work')
  assert.deepEqual(new Work('consumer-work', before).inspect(), work.inspect())
  assert.deepEqual(new DurableWork('consumer-work', journal).inspect(), work.inspect())
  assert.deepEqual(journal.read('consumer-work'), before)
  assert.equal(existsSync(new URL('./node_modules/wanxiangli/src/lifecycle/Work.fs', import.meta.url)), false)
  assert.equal(existsSync(new URL('./node_modules/@fable-org', import.meta.url)), false)
  const rounds = work.inspect().rounds.length
  journal.close()
  console.log(JSON.stringify({ done: true, externalEffects: effects.length, rounds }))
}
