// PACKAGE-HISTORICAL: scope-progress estimate/Advisor-queue package contract, not host product acceptance (see ../AGENTS.md «产品面边界»).
// PRODUCT-RETIRED (2026-10-29): Stall / ResetDue / remainingScopeTurnsEstimate are NOT host product contracts.
// These tests keep the scope-progress *package* historical durable/advisor-queue behavior.
// New lifecycle voice: wanxiangli/scope-retention + common law «Scope». Do not re-wire todowrite schema to estimates.
import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { ScopeProgress } from 'wanxiangli/scope-progress'

const withDatabase = async fn => {
  const dir = mkdtempSync(join(tmpdir(), 'wxs-progress-actor-'))
  const path = join(dir, 'progress.sqlite')
  const bind = () => {
    const port = ScopeProgress()
    port.configureJournal(() => new SqliteJournal(new DatabaseSync(path)))
    return port
  }
  try { await fn(bind) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('SPEC[scope-progress-008] actual ScopeProgress actor reloads durable paid baseline after cold restart', () => withDatabase(bind => {
  const first = bind()
  first.ensureEpoch('session', 'scope-1')
  first.record('session','scope-1','r1','a',7)
  first.record('session','scope-1','r1','b',3)
  assert.equal(first.settlePending('session','scope-1')[0].result.estimate, 3)
  assert.equal(first.status('session').estimate, 3)
  const afterCrash = bind()
  assert.equal(afterCrash.status('session').known, false, 'without authenticated epoch do not select a scope by guessing')
  assert.equal(afterCrash.recordedEpoch('session', 'scope-1'), 'scope-1')
  afterCrash.ensureEpoch('session','scope-1')
  assert.deepEqual([afterCrash.status('session').estimate,afterCrash.status('session').resetDue], [3,false])
  assert.equal(afterCrash.record('session','scope-1','r1','fresh',4).ok,false)
  assert.equal(afterCrash.record('session','scope-1','r2','tool',4).ok,true)
  const second = afterCrash.settlePending('session','scope-1')
  assert.equal(second[0].result.advisor,true)
  assert.equal(second[0].providerRunId,'r2')
  const replayed = bind()
  replayed.ensureEpoch('session','scope-1')
  assert.equal(replayed.status('session').estimate,4)
  assert.equal(replayed.settlePending('session','scope-1').length,1,
    'a durably settled stalled round remains a recoverable Advisor outbox obligation')
  assert.equal(replayed.settlePending('session','scope-1')[0].result.replayed,true)
  assert.equal(replayed.record('session','scope-1','r3','zero',0).ok,true)
  replayed.settlePending('session','scope-1')
  assert.equal(replayed.status('session').resetDue,true)
  const final = bind()
  final.ensureEpoch('session','scope-1')
  assert.equal(final.status('session').resetDue,true)
  final.reset('session','scope-2')
  assert.equal(final.status('session').known,false)
}))

test('SPEC[scope-progress-008] empty SQLite history cannot invent an initial Scope epoch', () => withDatabase(bind => {
  const actor = bind()
  assert.equal(actor.recordedEpoch('s','0'), '')
  assert.equal(actor.record('s','0','run','call',3).ok,true)
  const fresh = bind()
  assert.equal(fresh.recordedEpoch('s','0'),'0', 'an actual Recorded fact proves epoch 0 even before paid settlement')
  assert.equal(fresh.recordedEpoch('s','1'),'')
}))

test('SPEC[scope-progress-008] pending Provider observations survive process restart and settle minimum only once', () => withDatabase(bind => {
  const first = bind()
  first.record('s','scope','r1','a',8)
  first.record('s','scope','r1','b',2)
  const next = bind()
  next.ensureEpoch('s','scope')
  assert.equal(next.status('s').known,false)
  const results = next.settlePending('s','scope')
  assert.equal(results.length,1)
  assert.equal(results[0].result.estimate,2)
  assert.equal(next.settlePending('s','scope').length,0)
  assert.equal(next.status('s').estimate,2)
}))

test('SPEC[scope-progress-008] disk corruption and unknown SQLite admission never silently fall back to in-memory progress', () => {
  const port = ScopeProgress()
  port.configureJournal(() => {
    throw Error('SQLite primary unavailable')
  })
  assert.equal(port.record('s','scope','run','call',5).ok,false)
  assert.equal(port.status('s').ok,false)
  assert.throws(() => port.settlePending('s','scope'), /SQLite primary unavailable/)
})

test('SPEC[scope-progress-008] durable settlement outbox survives a crash before Advisor was dispatched', () => withDatabase(bind => {
  const first = bind()
  first.record('s','scope','before','a',3)
  first.settlePending('s','scope')
  first.record('s','scope','due','b',4)
  const committed = first.settle('s','scope','due')
  assert.deepEqual([committed.charged,committed.advisor,committed.replayed],[true,true,false])
  // Simulate the process dying before it could invoke AdvisorFlow.trigger.
  const reopened = bind()
  reopened.ensureEpoch('s','scope')
  const once = reopened.settlePending('s','scope')
  assert.equal(once.length,1)
  assert.equal(once[0].providerRunId,'due')
  assert.equal(once[0].result.replayed,true)
  assert.equal(once[0].result.advisor,true)
  assert.equal(reopened.status('s').estimate,4)
  const twice = reopened.settlePending('s','scope')
  assert.equal(twice.length,1, 'one stable trigger identity is retried only through durable Claim dedupe')
  assert.equal(twice[0].providerRunId,'due')
}))

test('SPEC[scope-progress-008] real SIGKILL after a durable tool report restores its paid minimum', () => withDatabase(bind => {
  const directory = mkdtempSync(join(tmpdir(), 'wxs-progress-sigkill-'))
  try {
    const path = join(directory, 'killed.sqlite')
    const worker = join(dirname(fileURLToPath(import.meta.url)), 'support/progress-admission-kill-worker.mjs')
    const dead = spawnSync(process.execPath, [worker, path, 'after-record'], {encoding:'utf8'})
    assert.equal(dead.signal, 'SIGKILL', dead.stderr)
    const resumed = ScopeProgress()
    resumed.configureJournal(() => new SqliteJournal(new DatabaseSync(path)))
    resumed.ensureEpoch('killed-session','scope-1')
    assert.equal(resumed.status('killed-session').known, false)
    const paid = resumed.settlePending('killed-session','scope-1')
    assert.equal(paid.length, 1)
    assert.equal(paid[0].result.estimate, 5)
    assert.equal(resumed.status('killed-session').estimate, 5)
  } finally { rmSync(directory, {recursive:true,force:true}) }
}))

test('SPEC[scope-progress-008] real SIGKILL after settlement does not lose a stalled AdvisorDue', () => withDatabase(bind => {
  const directory = mkdtempSync(join(tmpdir(), 'wxs-progress-sigkill-outbox-'))
  try {
    const path = join(directory, 'killed.sqlite')
    const worker = join(dirname(fileURLToPath(import.meta.url)), 'support/progress-admission-kill-worker.mjs')
    const dead = spawnSync(process.execPath, [worker, path, 'after-settle'], {encoding:'utf8'})
    assert.equal(dead.signal, 'SIGKILL', dead.stderr)
    const resumed = ScopeProgress()
    resumed.configureJournal(() => new SqliteJournal(new DatabaseSync(path)))
    resumed.ensureEpoch('killed-session','scope-1')
    assert.deepEqual([resumed.status('killed-session').estimate, resumed.status('killed-session').resetDue], [6,false])
    const due = resumed.settlePending('killed-session','scope-1')
    assert.deepEqual(due.map(x => x.providerRunId), ['provider-2'])
    assert.equal(due[0].result.advisor, true)
    assert.equal(due[0].result.replayed, true)
    assert.equal(resumed.record('killed-session','scope-1','provider-2','tool-2',5).ok, false)
  } finally { rmSync(directory, {recursive:true,force:true}) }
}))

test('SPEC[scope-progress-008] two host workspaces keep independent journals after global plugin initialization', () => {
  const firstRoot = mkdtempSync(join(tmpdir(), 'wxs-progress-root-first-'))
  const secondRoot = mkdtempSync(join(tmpdir(), 'wxs-progress-root-second-'))
  try {
    const port = ScopeProgress()
    const factoryA = () => new SqliteJournal(new DatabaseSync(join(firstRoot, 'progress.sqlite')))
    const factoryB = () => new SqliteJournal(new DatabaseSync(join(secondRoot, 'progress.sqlite')))
    port.configureJournal(factoryA)
    port.bindSessionJournal('session-a', factoryA)
    assert.equal(port.record('session-a', '1', 'r1', 'call', 4).ok, true)
    assert.equal(port.settle('session-a', '1', 'r1').estimate, 4)
    port.configureJournal(factoryB)
    port.bindSessionJournal('session-b', factoryB)
    assert.equal(port.record('session-b', '1', 'r1', 'call', 9).ok, true)
    assert.equal(port.settle('session-b', '1', 'r1').estimate, 9)
    assert.equal(port.status('session-a').estimate, 4,
      'activating workspace B must never redirect an existing session A to B SQLite')
    assert.equal(port.status('session-b').estimate, 9)
    const a = new SqliteJournal(new DatabaseSync(join(firstRoot, 'progress.sqlite')))
    const b = new SqliteJournal(new DatabaseSync(join(secondRoot, 'progress.sqlite')))
    try {
      assert.equal(a.read('scope-progress:9:session-a:1:1').length, 2)
      assert.equal(b.read('scope-progress:9:session-a:1:1').length, 0)
    } finally { a.close(); b.close() }
  } finally {
    rmSync(firstRoot, {recursive:true, force:true})
    rmSync(secondRoot, {recursive:true, force:true})
  }
})
