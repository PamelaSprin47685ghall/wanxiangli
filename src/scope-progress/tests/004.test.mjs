// PRODUCT-RETIRED (2026-10-29): Stall / ResetDue / remainingScopeTurnsEstimate are NOT host product contracts.
// These tests keep the scope-progress *package* historical durable/advisor-queue behavior.
// New lifecycle voice: wanxiangli/scope-retention + common law «Scope». Do not re-wire todowrite schema to estimates.
import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { advisorClaim, advisorFinish, advisorPending, AdvisorFlow, AdvisorProcessQueue } from 'wanxiangli/scope-progress'

const withJournal = (db, action) => {
  const journal = new SqliteJournal(new DatabaseSync(db))
  try { return action(journal) } finally { journal.close() }
}
const tempDb = async (body) => {
  const directory = mkdtempSync(join(tmpdir(), 'scope-advisor-admission-'))
  try { return await body(join(directory, 'advisor.sqlite')) }
  finally { rmSync(directory, { recursive: true, force: true }) }
}

test('SPEC[scope-progress-004] one physical committed trigger survives cold reopen and refuses a second consultation', () => tempDb((db) => {
  const committed = withJournal(db, journal => advisorClaim(journal, 'session', 'scope-1', 'run-1', 'work stalled'))
  assert.deepEqual([committed.ok, committed.accepted, committed.status], [true, true, 'Committed'])
  const replayed = withJournal(db, journal => advisorClaim(journal, 'session', 'scope-1', 'run-1', 'work stalled'))
  assert.deepEqual([replayed.ok, replayed.accepted, replayed.status], [true, false, 'Replayed'])
  const conflict = withJournal(db, journal => advisorClaim(journal, 'session', 'scope-1', 'run-1', 'different question'))
  assert.deepEqual([conflict.ok, conflict.accepted, conflict.status], [false, false, 'Conflict'])
  const collisionOne = withJournal(db, journal => advisorClaim(journal, 'collision', 'a:b', 'c', 'first'))
  const collisionTwo = withJournal(db, journal => advisorClaim(journal, 'collision', 'a', 'b:c', 'second'))
  assert.equal(collisionOne.accepted, true)
  assert.equal(collisionTwo.accepted, true, 'colon-bearing composite IDs cannot collide')
  const next = withJournal(db, journal => advisorClaim(journal, 'session', 'scope-2', 'run-1', 'work stalled'))
  assert.deepEqual([next.ok, next.accepted, next.status], [true, true, 'Committed'])
  const other = withJournal(db, journal => advisorClaim(journal, 'other-session', 'scope-1', 'run-1', 'work stalled'))
  assert.deepEqual([other.ok, other.accepted, other.status], [true, true, 'Committed'])
  const rows = withJournal(db, journal => journal.read('advisor-process:session'))
  assert.equal(rows.length, 2, 'one scope or report replay never grows the committed log')
}))

test('SPEC[scope-progress-004] SIGKILL after committed admission cannot cause a paid replay', () => tempDb((db) => {
  const worker = join(dirname(fileURLToPath(import.meta.url)), 'support/advisor-admission-kill-worker.mjs')
  const outcome = spawnSync(process.execPath, [worker, db], { encoding: 'utf8' })
  assert.equal(outcome.signal, 'SIGKILL', outcome.stderr)
  const replayed = withJournal(db, journal => advisorClaim(journal, 'killed-session', 'scope-1', 'paid-run', 'pay for advice'))
  assert.equal(replayed.ok, true)
  assert.equal(replayed.accepted, false, 'recovery must observe instead of paying a second time')
  assert.equal(replayed.status, 'Replayed')
}))

test('SPEC[scope-progress-004] conflict, Unknown and storage exceptions never grant an external model call', async () => {
  const failures = [
    { read: () => [], append: () => ({ status: 'Unknown', reason: 'commit outcome unknown' }) },
    { read: () => [], append: () => ({ status: 'NotWritten', reason: 'refused' }) },
    { read: () => { throw Error('checksum mismatch') }, append: () => { throw Error('unreachable') } },
  ]
  for (const journal of failures) {
    let calls = 0
    const flow = AdvisorFlow(AdvisorProcessQueue(), {
      CurrentEpoch: () => 'scope-1',
      LanguageFor: () => 'en',
      Claim: async (session, epoch, report, issue) => advisorClaim(journal, session, epoch, report, issue),
      Finish: async () => ({ ok: false, status: 'Unknown' }),
      BeginStage: async () => ({ ok: true, start: true }),
      ConfirmStage: async () => ({ ok: true, status: 'Committed' }),
      Pending: async () => ({ ok: true, pending: [] }),
      AskWorker: async () => { calls++; return { Ok: true, Prose: 'worker', Reason: '' } },
      AskSeat: async () => { calls++; return { Ok: true, Prose: 'advisor', Reason: '' } },
      SendSteer: async () => { calls++; return { Ok: true, Prose: '', Reason: '' } },
    })
    const receipt = await flow.trigger('session', 'scope-1', 'report', 'issue')
    assert.equal(receipt.ok, false)
    assert.equal(calls, 0, 'no model or steer can be issued without committed admission')
  }
})

test('SPEC[scope-progress-004] durable replay is rejected before a fresh process queue creates a seat', async () => tempDb(async (db) => {
  const first = withJournal(db, journal => advisorClaim(journal, 's', 'scope-1', 'report-1', 'issue'))
  assert.equal(first.accepted, true)
  let calls = 0
  const flow = AdvisorFlow(AdvisorProcessQueue(), {
    CurrentEpoch: () => 'scope-1',
    LanguageFor: () => 'en',
    Claim: async (sid, epoch, id, issue) => withJournal(db, journal => advisorClaim(journal, sid, epoch, id, issue)),
    Finish: async (sid, epoch, ids, outcome) => withJournal(db, journal => advisorFinish(journal, sid, epoch, ids, outcome)),
    BeginStage: async () => ({ ok: true, start: true }),
    ConfirmStage: async () => ({ ok: true, status: 'Committed' }),
    Pending: async () => ({ ok: true, pending: [] }),
    AskWorker: async () => { calls++; return { Ok: true, Prose: 'worker', Reason: '' } },
    AskSeat: async () => { calls++; return { Ok: true, Prose: 'advisor', Reason: '' } },
    SendSteer: async () => { calls++; return { Ok: true, Prose: '', Reason: '' } },
  })
  const seen = await flow.trigger('s', 'scope-1', 'report-1', 'issue')
  assert.equal(seen.ok, true)
  assert.equal(seen.start, false)
  assert.equal(calls, 0)
}))


test('SPEC[scope-progress-004] two independent owners cannot start concurrent consultations for one Session', async () => tempDb(async (db) => {
  let releaseFirst
  let completedFirst
  const held = new Promise(resolve => { releaseFirst = resolve })
  const settled = new Promise(resolve => { completedFirst = resolve })
  const calls = []
  const make = label => AdvisorFlow(AdvisorProcessQueue(), {
    CurrentEpoch: () => 'scope-one',
    LanguageFor: () => 'en',
    Claim: async (sid, epoch, report, issue) => withJournal(db, journal => advisorClaim(journal, sid, epoch, report, issue)),
    Finish: async (sid, epoch, ids, outcome) => {
      const outcomeReceipt = withJournal(db, journal => advisorFinish(journal, sid, epoch, ids, outcome))
      if (label === 'first') completedFirst()
      return outcomeReceipt
    },
    BeginStage: async () => ({ ok: true, start: true }),
    ConfirmStage: async () => ({ ok: true, status: 'Committed' }),
    Pending: async () => ({ ok: true, pending: [] }),
    AskWorker: async () => { calls.push(label); if (label === 'first') await held; return { Ok: true, Prose: 'worker', Reason: '' } },
    AskSeat: async () => ({ Ok: true, Prose: 'advisor', Reason: '' }),
    SendSteer: async () => ({ Ok: true, Prose: '', Reason: '' }),
  })
  const first = make('first')
  const second = make('second')
  try {
    assert.equal((await first.trigger('s', 'scope-one', 'first-report', 'first problem')).start, true)
    const duplicateProcess = await second.trigger('s', 'scope-one', 'second-report', 'second problem')
    assert.equal(duplicateProcess.start, false, 'a second process must be fenced by durable active identity')
    assert.deepEqual(calls, ['first'])
  } finally {
    releaseFirst()
    await Promise.race([settled, new Promise((_, reject) => setTimeout(() => reject(Error('first Advisor terminal never settled')), 2000))])
  }
}))


test('SPEC[scope-progress-004] only a committed Finished releases the global Session fence', () => tempDb((db) => {
  const claim = (report) => withJournal(db, journal => advisorClaim(journal, 's', 'scope', report, 'problem'))
  const finish = (reports, outcome) => withJournal(db, journal => advisorFinish(journal, 's', 'scope', reports, outcome))
  assert.equal(claim('first').held, false)
  assert.equal(claim('second').held, true, 'an unresolved consultation owns the session fence')
  assert.deepEqual([finish(['first'], 'Completed').ok, finish(['first'], 'Completed').status], [true, 'Replayed'])
  assert.equal(finish(['first'], 'Failed').status, 'Conflict', 'a finished identity cannot change outcome')
  assert.equal(claim('third').held, true, 'a coalesced waiting report remains unresolved until its own terminal')
  assert.equal(finish(['second', 'third'], 'Completed').status, 'Committed')
  assert.equal(claim('fourth').held, false, 'once all earlier reports settled a new Process can start')
  assert.equal(finish(['unknown'], 'Completed').ok, false, 'a nonexistent report cannot manufacture a terminal')
}))

test('SPEC[scope-progress-004] Unknown terminal cannot release an active queue or start the waiting Process', async () => {
  const queue = AdvisorProcessQueue()
  let settleObserved
  const atSettlement = new Promise(resolve => { settleObserved = resolve })
  let workerCalls = 0
  const flow = AdvisorFlow(queue, {
    CurrentEpoch: () => 'scope',
    LanguageFor: () => 'en',
    Claim: async () => ({ ok: true, accepted: true, held: false }),
    Finish: async () => { settleObserved(); return { ok: false, status: 'Unknown' } },
    BeginStage: async () => ({ ok: true, start: true }),
    ConfirmStage: async () => ({ ok: true, status: 'Committed' }),
    Pending: async () => ({ ok: true, pending: [] }),
    AskWorker: async () => { workerCalls++; return { Ok: true, Prose: 'worker', Reason: '' } },
    AskSeat: async () => ({ Ok: true, Prose: 'seat', Reason: '' }),
    SendSteer: async () => ({ Ok: true, Prose: '', Reason: '' }),
  })
  assert.equal((await flow.trigger('s', 'scope', 'one', 'problem')).start, true)
  await atSettlement
  assert.equal(queue.hasActive('s', 'scope'), true, 'no committed terminal means the active fence remains')
  assert.equal((await flow.trigger('s', 'scope', 'two', 'other problem')).start, false)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(workerCalls, 2, 'only the original A/C requests were permitted')
})

test('SPEC[scope-progress-004] revision contention preserves both report identities and does not grant concurrent dispatch', () => tempDb((db) => {
  const adapter = {
    read: (stream) => withJournal(db, journal => journal.read(stream)),
    append: (stream, revision, requestId, body) => {
      if (!adapter.injected) {
        adapter.injected = true
        const competing = withJournal(db, journal => advisorClaim(journal, 's', 'scope', 'winner', 'first issue'))
        assert.equal(competing.status, 'Committed', 'a different process advanced the same stream')
      }
      return withJournal(db, journal => journal.append(stream, revision, requestId, body))
    },
    injected: false,
  }
  const receipt = advisorClaim(adapter, 's', 'scope', 'loser', 'second issue')
  assert.equal(receipt.status, 'Committed', 'a definite RevisionConflict should reread and append')
  assert.equal(receipt.accepted, true)
  assert.equal(receipt.held, true, 'the other admitted consultation owns the active fence')
  const recorded = withJournal(db, journal => journal.read('advisor-process:s')).map(JSON.parse)
  assert.deepEqual(recorded.map(event => event.report), ['winner', 'loser'])
}))

test('SPEC[scope-progress-004] Finished CAS contention rechecks admitted reports without an extra model request', () => tempDb((db) => {
  withJournal(db, journal => advisorClaim(journal, 's', 'scope', 'report-1', 'first issue'))
  const adapter = {
    read: stream => withJournal(db, journal => journal.read(stream)),
    append: (stream, revision, requestId, body) => {
      if (!adapter.injected) {
        adapter.injected = true
        const competing = withJournal(db, journal => advisorClaim(journal, 's', 'scope', 'report-2', 'waiting issue'))
        assert.equal(competing.status, 'Committed')
      }
      return withJournal(db, journal => journal.append(stream, revision, requestId, body))
    },
    injected: false,
  }
  const receipt = advisorFinish(adapter, 's', 'scope', ['report-1'], 'Completed')
  assert.equal(receipt.status, 'Committed')
  assert.equal(receipt.ok, true)
  const next = withJournal(db, journal => advisorClaim(journal, 's', 'scope', 'report-3', 'further issue'))
  assert.equal(next.held, true, 'the competing report remains pending')
  assert.deepEqual(withJournal(db, journal => journal.read('advisor-process:s')).map(JSON.parse).map(x => x.kind),
    ['Admitted', 'Admitted', 'Finished', 'Admitted'])
}))

test('SPEC[scope-progress-004] thrown Finished keeps the in-memory fence and does not crash detached processing', async () => {
  const queue = AdvisorProcessQueue()
  let observed = 0
  let began
  const arrived = new Promise(resolve => { began = resolve })
  const flow = AdvisorFlow(queue, {
    CurrentEpoch: () => 'scope',
    LanguageFor: () => 'en',
    Claim: async () => ({ok: true, accepted: true, held: false}),
    Finish: async () => { began(); throw Error('SQLite terminal write failed') },
    BeginStage: async () => ({ ok: true, start: true }),
    ConfirmStage: async () => ({ ok: true, status: 'Committed' }),
    Pending: async () => ({ ok: true, pending: [] }),
    AskWorker: async () => { observed++; return {Ok: true, Prose: 'worker', Reason: ''} },
    AskSeat: async () => ({Ok: true, Prose: 'seat', Reason: ''}),
    SendSteer: async () => ({Ok: true, Prose: '', Reason: ''}),
  })
  assert.equal((await flow.trigger('s', 'scope', 'first', 'problem')).start, true)
  await arrived
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(queue.hasActive('s', 'scope'), true, 'unknown terminal never releases the active process')
  assert.equal((await flow.trigger('s', 'scope', 'next', 'follow-up')).start, false)
  assert.equal(observed, 2, 'only A/C of the first four-step process ran')
})

test('SPEC[scope-progress-004] cold recovery reports exact unresolved identities without retry authorization', () => tempDb((db) => {
  const worker = join(dirname(fileURLToPath(import.meta.url)), 'support/advisor-admission-kill-worker.mjs')
  const killed = spawnSync(process.execPath, [worker, db], {encoding: 'utf8'})
  assert.equal(killed.signal, 'SIGKILL')
  const pending = withJournal(db, journal => advisorPending(journal, 'killed-session', 'scope-1'))
  assert.equal(pending.ok, true)
  assert.deepEqual(Array.from(pending.pending), [{
    reportId: 'paid-run',
    issue: 'pay for advice',
    state: 'Unresolved',
  }])
  const retry = withJournal(db, journal => advisorClaim(journal, 'killed-session', 'scope-1', 'paid-run', 'pay for advice'))
  assert.equal(retry.accepted, false)
  const finished = withJournal(db, journal => advisorFinish(journal, 'killed-session', 'scope-1', ['paid-run'], 'Failed'))
  assert.equal(finished.status, 'Committed')
  const after = withJournal(db, journal => advisorPending(journal, 'killed-session', 'scope-1'))
  assert.equal(after.ok, true)
  assert.deepEqual(Array.from(after.pending), [])
}))

test('SPEC[scope-progress-004] independent operating-system processes observe one SQLite session fence', () => tempDb((db) => {
  const executable = join(dirname(fileURLToPath(import.meta.url)), 'support/advisor-claim-worker.mjs')
  const invoke = (action, id = '') => {
    const child = spawnSync(process.execPath, [executable, db, action, id], {encoding: 'utf8'})
    assert.equal(child.status, 0, child.stderr)
    return JSON.parse(child.stdout)
  }
  const one = invoke('claim', 'report-a')
  assert.deepEqual([one.ok, one.accepted, one.held], [true, true, false])
  const two = invoke('claim', 'report-b')
  assert.deepEqual([two.ok, two.accepted, two.held], [true, true, true])
  assert.deepEqual(Array.from(invoke('pending').pending).map(x => x.reportId), ['report-a', 'report-b'])
  assert.equal(invoke('finish', 'report-a').status, 'Committed')
  assert.deepEqual(Array.from(invoke('pending').pending).map(x => x.reportId), ['report-b'])
  assert.equal(invoke('finish', 'report-b').status, 'Committed')
  assert.deepEqual(Array.from(invoke('pending').pending), [])
  const fresh = invoke('claim', 'report-c')
  assert.equal(fresh.held, false, 'a fully settled OS-process history permits the next consultation')
}))
