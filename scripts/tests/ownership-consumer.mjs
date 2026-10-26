import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Ownership } from 'wanxiangli/ownership'

const [runtime, mode, database, effects, receiptPath] = process.argv.slice(2)
assert.deepEqual(Object.keys(await import('wanxiangli/ownership')), ['Ownership'])
const registry = 'ownership-consumer'

if (mode === 'isolated') {
  const owner = new Ownership(registry)
  owner.execute('open', { type: 'OpenScope', scopeId: 'work', parentId: null })
  const lease = owner.execute('reserve', { type: 'Reserve', resourceId: 'child', scopeId: 'work', kind: 'process' }).result.lease
  owner.execute('drain', { type: 'Drain', scopeId: 'work' })
  const restored = new Ownership(registry, owner.records())
  assert.equal(restored.blockers('work')[0].phase, 'Reserved')
  assert.throws(() => restored.execute('close', { type: 'Close', scopeId: 'work' }), /unsettled/)
  restored.execute('refused', { type: 'NotStarted', lease, reason: 'No launch was attempted.' })
  restored.execute('close', { type: 'Close', scopeId: 'work' })
  assert.equal(restored.scope('work').phase, 'Closed')
  console.log(JSON.stringify({ isolated: true, runtime }))
} else {
  const { SqliteJournal } = await import('wanxiangli/eventstore')
  const { ProcessSession } = await import('wanxiangli/runtime')
  const connection = runtime === 'node'
    ? new (await import('node:sqlite')).DatabaseSync(database)
    : new (await import('bun:sqlite')).Database(database)
  const journal = new SqliteJournal(connection)
  let owner = new Ownership(registry, journal.read(registry))
  let child = null
  let keepOpenForCrash = false

  // C 独自拥有提交顺序；候选不在 Committed 之前发布，也没有自动重试。
  function commit(requestId, message) {
    const records = journal.read(registry)
    const candidate = new Ownership(registry, records)
    const proposal = candidate.execute(requestId, message)
    if (proposal.status !== 'Applied') return proposal
    const receipt = journal.append(registry, records.length, requestId, proposal.record)
    assert.equal(receipt.status, 'Committed', JSON.stringify(receipt))
    owner = candidate
    return { status: receipt.status, result: proposal.result }
  }

  function start(code, args = []) {
    child = new ProcessSession({ executable: process.execPath, args: ['--input-type=module', '-e', code, ...args], cwd: tmpdir(), env: {}, tailBytes: 4096, maxWriteBytes: 1024 })
    return child
  }

  async function ready() {
    const deadline = performance.now() + 5000
    while (performance.now() < deadline) {
      const text = child.read('stdout', 0).text ?? ''
      if (text.includes('\n')) return JSON.parse(text.trim())
      assert.notEqual(child.inspect().phase, 'Closed', child.read('stderr', 0).text)
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error('The real child did not reach the readiness barrier')
  }

  try {
    if (mode === 'retirement') {
      const { DurableWork } = await import('wanxiangli/durable-work')
      const work = new DurableWork('consumer-work', journal)
      function workCommit(id, message) {
        const response = work.execute(id, message)
        assert.equal(response.status, 'Committed', JSON.stringify(response))
        return response.result
      }
      function confirmEffect(effect, outcome, extra = {}) {
        workCommit(`confirm-${effect.id}-${outcome}`, { type: 'Confirm', effectId: effect.id, outcome, ...extra })
      }
      workCommit('open', { type: 'Review', office: 'Manager', providerRunId: 'run', toolCallId: 'open', updates: [{ key: 'job', value: 'run' }] })
      const relay = workCommit('clear', { type: 'Review', office: 'Manager', providerRunId: 'run', toolCallId: 'clear', updates: [{ key: 'job', value: null }] })
      assert.equal(relay.kind, 'Relayed')
      confirmEffect(relay.effect, 'Sent')
      const advanced = workCommit('advance', { type: 'Review', office: 'Manager', providerRunId: 'run', toolCallId: 'advance', updates: [] })
      assert.equal(advanced.milestone, '收尾')
      confirmEffect(advanced.effect, 'Sent')
      const scope = advanced.incumbencyId
      commit('root', { type: 'OpenScope', scopeId: 'work', parentId: null })
      commit('tenure', { type: 'OpenScope', scopeId: scope, parentId: 'work' })
      const fixed = commit('fixed', { type: 'Reserve', resourceId: 'fixed-devops', scopeId: 'work', kind: 'session' }).result.lease
      const reservation = commit('child', { type: 'Reserve', resourceId: 'real-child', scopeId: scope, kind: 'process' })
      assert.equal(reservation.status, 'Committed')
      const lease = reservation.result.lease
      start(`
        process.on('SIGTERM', () => {});
        console.log(JSON.stringify({ instance: process.argv[1] }));
        setInterval(() => {}, 1000);
        setTimeout(() => process.exit(90), 8000);
      `, [lease.token])
      const begun = await child.started()
      assert.equal(begun.kind, 'Started')
      assert.equal((await ready()).instance, lease.token)
      const binding = { externalId: String(begun.pid), incarnationId: lease.token }
      commit('started', { type: 'Started', lease, binding })
      commit('drain', { type: 'Drain', scopeId: scope })
      commit('cancel', { type: 'Cancel', lease })
      assert.equal(child.signal('SIGTERM').kind, 'Requested')
      assert.equal((await child.wait(20)).kind, 'TimedOut')
      assert.equal(commit('unknown', { type: 'Unknown', lease }).status, 'Observed')
      const blockers = owner.blockers(scope).map(resource => resource.lease.token)
      assert.equal(blockers.length, 1)
      const blocked = work.execute('blocked', { type: 'Review', office: 'Manager', providerRunId: 'run', toolCallId: 'blocked', updates: [], blockers })
      assert.equal(blocked.status, 'Observed')
      assert.equal(blocked.result.kind, 'Blocked')
      assert.equal(work.inspect().active.id, scope)
      assert.equal(child.signal('SIGKILL').kind, 'Requested')
      const stopped = await child.wait(5000)
      assert.equal(stopped.kind, 'Closed')
      assert.equal(stopped.state.exit.signal, 'SIGKILL')
      commit('ended', { type: 'Ended', lease, binding, outcome: 'Cancelled' })
      commit('close', { type: 'Close', scopeId: scope })
      assert.deepEqual(owner.blockers(scope), [])
      assert.deepEqual(owner.blockers('work').map(resource => resource.lease), [fixed])
      assert.equal(owner.resource(fixed).cancellationRequested, false)
      assert.equal(workCommit('delivered', { type: 'Review', office: 'Manager', providerRunId: 'run', toolCallId: 'delivered', updates: [], blockers: [] }).kind, 'Completed')
      console.log(JSON.stringify({ runtime, retired: true, blockedBeforePhysicalEnd: true, parentReservationRetained: true }))
    } else if (mode === 'crash-start') {
      commit('open', { type: 'OpenScope', scopeId: 'work', parentId: null })
      const reservation = commit('reserve', { type: 'Reserve', resourceId: 'child', scopeId: 'work', kind: 'process' })
      assert.equal(reservation.status, 'Committed')
      const lease = reservation.result.lease
      start(`
        import { appendFileSync } from 'node:fs';
        appendFileSync(process.argv[1], 'effect\\n');
      `, [effects])
      const begun = await child.started()
      assert.equal(begun.kind, 'Started')
      const binding = { externalId: String(begun.pid), incarnationId: lease.token }
      commit('started', { type: 'Started', lease, binding })
      const stopped = await child.wait(5000)
      assert.equal(stopped.kind, 'Closed')
      assert.equal(stopped.state.exit.code, 0)
      // 独立的物理观察者已见到 Closed；故意尚未提交归属终态。
      writeFileSync(receiptPath, JSON.stringify({ lease, binding, outcome: 'Completed', exit: stopped.state.exit }))
      assert.equal(owner.blockers('work').length, 1)
      keepOpenForCrash = true
      console.log(JSON.stringify({ phase: 'unsettled-after-real-exit', head: owner.head() }))
      setInterval(() => {}, 1000)
    } else {
      assert.equal(mode, 'recover')
      assert.equal(owner.blockers('work').length, 1)
      assert.throws(() => owner.execute('close-too-soon', { type: 'Close', scopeId: 'work' }), /unsettled/)
      assert.equal(commit('reserve', { type: 'Reserve', resourceId: 'child', scopeId: 'work', kind: 'process' }).status, 'Replayed')
      const witness = JSON.parse(readFileSync(receiptPath, 'utf8'))
      assert.equal(witness.exit.code, 0)
      assert.equal(witness.binding.incarnationId, witness.lease.token)
      assert.deepEqual(owner.resource(witness.lease).binding, witness.binding)
      const ended = { type: 'Ended', lease: witness.lease, binding: witness.binding, outcome: witness.outcome }
      commit('reconcile', ended)
      const count = journal.read(registry).length
      assert.equal(commit('late-end', ended).status, 'Observed')
      assert.equal(journal.read(registry).length, count)
      commit('closed', { type: 'Close', scopeId: 'work' })
      assert.equal(readFileSync(effects, 'utf8'), 'effect\n')
      console.log(JSON.stringify({ runtime, recovered: true, externalEffects: 1, unsettled: owner.inspect().unsettled }))
    }
  } finally {
    if (!keepOpenForCrash) {
      if (child && child.inspect().phase !== 'Closed') {
        child.signal('SIGKILL')
        assert.equal((await child.wait(5000)).kind, 'Closed')
      }
      journal.close()
    }
  }
}
