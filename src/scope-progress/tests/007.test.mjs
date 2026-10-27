import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteJournal } from 'wanxiangli/eventstore'
import {
  durableProgressRecord, durableProgressSettle,
  durableProgressStatus, durableProgressPending,
} from 'wanxiangli/scope-progress'

const database = async action => {
  const directory = mkdtempSync(join(tmpdir(), 'wxs-durable-progress-'))
  const file = join(directory, 'scope.sqlite')
  const use = fn => {
    const journal = new SqliteJournal(new DatabaseSync(file))
    try { return fn(journal) } finally { journal.close() }
  }
  try { await action(use) } finally { rmSync(directory, { recursive: true, force: true }) }
}

test('SPEC[scope-progress-007] SQLite cold-open retains minimum, paid rounds, advisory comparison and zero latch', () => database(use => {
  const r = (run, call, value) => use(j => durableProgressRecord(j, 's', 'scope1', run, call, value))
  const settle = run => use(j => durableProgressSettle(j, 's', 'scope1', run))
  const status = () => use(j => durableProgressStatus(j, 's', 'scope1'))
  assert.equal(status().known, false)
  assert.equal(settle('free').charged, false)
  assert.equal(r('round-a', 'later', 9).minimum, 9)
  assert.equal(r('round-a', 'earlier', 4).minimum, 4)
  assert.equal(r('round-a', 'earlier', 4).replayed, true)
  assert.equal(r('round-a', 'earlier', 8).status, 'Conflict')
  const first = settle('round-a')
  assert.deepEqual([first.estimate, first.advisor, first.resetDue], [4, false, false])
  assert.equal(settle('round-a').replayed, true)
  assert.equal(r('round-a', 'after', 1).status, 'Conflict')
  assert.deepEqual([status().known, status().estimate, status().resetDue], [true, 4, false])
  assert.equal(r('round-b', 'only', 5).ok, true)
  assert.equal(settle('round-b').advisor, true)
  assert.equal(r('round-b2', 'tenth', 4.9).ok, true)
  assert.deepEqual([settle('round-b2').advisor, settle('round-b2').charged], [false, true],
    'the promised 0.1 of shrinkage is charged without escalating')
  assert.equal(r('round-b3', 'short', 4.85).ok, true)
  assert.deepEqual([settle('round-b3').advisor, settle('round-b3').trigger], [true, 'Stall'],
    'a drop below the judged bar escalates even though the number fell')
  assert.equal(r('round-c', 'low', 2).ok, true)
  assert.equal(settle('round-c').advisor, false)
  assert.equal(r('round-d', 'zero', 0).ok, true)
  assert.equal(settle('round-d').resetDue, true)
  assert.equal(status().resetDue, true)
  assert.equal(r('round-e', 'zero-again', 0).ok, true)
  assert.equal(settle('round-e').advisor, true)
  const fresh = use(j => durableProgressStatus(j, 's', 'scope2'))
  assert.deepEqual([fresh.known, fresh.resetDue], [false, false], 'actual new Scope has separate history')
  assert.equal(use(j => durableProgressRecord(j, 's', 'scope2', 'round-a', 'only', 5)).minimum, 5)
  assert.equal(use(j => durableProgressSettle(j, 's', 'scope2', 'round-a')).advisor, false)
}))

test('SPEC[scope-progress-007] the durable Advisor trigger survives cold reopen and replay', () => database(use => {
  const round = (run, value) => {
    use(j => durableProgressRecord(j, 's', 'scope1', run, 'call-' + run, value))
    return use(j => durableProgressSettle(j, 's', 'scope1', run))
  }
  assert.equal(round('five', 5).trigger ?? null, null)
  assert.equal(round('zero', 0).trigger ?? null, null)
  assert.equal(round('four', 4).trigger, 'ResetDue')
  assert.equal(round('three', 3).trigger, 'ResetDue')
  const replayed = use(j => durableProgressSettle(j, 's', 'scope1', 'three'))
  assert.deepEqual([replayed.replayed, replayed.trigger], [true, 'ResetDue'])
}))

test('SPEC[scope-progress-007] pending tool observations survive SIGKILL-like cold reopen without settling prematurely', () => database(use => {
  use(j => durableProgressRecord(j, 'session', '1', 'provider-a', 'tool-a', 10))
  use(j => durableProgressRecord(j, 'session', '1', 'provider-a', 'tool-b', 2))
  use(j => durableProgressRecord(j, 'session', '1', 'provider-b', 'tool-c', 7))
  assert.deepEqual(Array.from(use(j => durableProgressPending(j, 'session', '1')).pending),
    ['provider-a', 'provider-b'])
  const first = use(j => durableProgressSettle(j, 'session', '1', 'provider-a'))
  assert.equal(first.estimate, 2)
  assert.deepEqual(Array.from(use(j => durableProgressPending(j, 'session', '1')).pending),
    ['provider-b'])
  assert.equal(use(j => durableProgressSettle(j, 'session', '1', 'provider-b')).estimate, 7)
  assert.equal(use(j => durableProgressSettle(j, 'session', '1', 'provider-b')).replayed, true)
  assert.deepEqual(Array.from(use(j => durableProgressPending(j, 'session', '1')).pending), [])
}))

test('SPEC[scope-progress-007] two journal writers cannot lose the smaller accepted call on a definite CAS race', () => database(use => {
  let raced = false
  const journal = {
    read: stream => use(j => j.read(stream)),
    append: (stream, revision, request, body) => {
      if (!raced) {
        raced = true
        assert.equal(use(j => durableProgressRecord(j, 's', 'epoch', 'run', 'rival', 3)).ok, true)
      }
      return use(j => j.append(stream, revision, request, body))
    },
  }
  const record = durableProgressRecord(journal, 's', 'epoch', 'run', 'ours', 8)
  assert.equal(record.ok, true)
  assert.equal(record.minimum, 3, 'read revision and paid minimum must be refreshed after CAS race')
  assert.equal(use(j => durableProgressSettle(j, 's', 'epoch', 'run')).estimate, 3)
}))

test('SPEC[scope-progress-007] unknown append and corrupt history fail closed without inventing remaining budget', () => {
  const unknown = {
    read: () => [],
    append: () => ({status: 'Unknown', reason: 'COMMIT result unknown'}),
  }
  assert.equal(durableProgressRecord(unknown, 's', 'e', 'r', 'call', 5).ok, false)
  assert.equal(durableProgressSettle(unknown, 's', 'e', 'r').charged, false)
  const corrupt = { read: () => ['bad-json'], append: () => { throw Error('should not append') } }
  assert.equal(durableProgressStatus(corrupt, 's', 'e').status, 'Unknown')
  assert.equal(durableProgressPending(corrupt, 's', 'e').status, 'Unknown')
})


test('SPEC[scope-progress-007] a replayed physical ToolCallId is not billed again under a new OMP turn witness', () => database(use => {
  const call=(run,score)=>use(j=>durableProgressRecord(j,'s','scope','run-'+run,'physical-call',score))
  assert.equal(call('before-restart',4).replayed,false)
  assert.equal(use(j=>durableProgressSettle(j,'s','scope','run-before-restart')).estimate,4)
  assert.equal(call('after-restart',4).replayed,true,'reissued toolCall must not be written into the new Provider run')
  assert.equal(call('after-restart',3).status,'Conflict')
  assert.equal(use(j=>durableProgressSettle(j,'s','scope','run-after-restart')).charged,false)
  assert.equal(use(j=>durableProgressStatus(j,'s','scope')).estimate,4)
}))
