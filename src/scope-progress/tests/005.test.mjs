// PRODUCT-RETIRED (2026-10-29): Stall / ResetDue / remainingScopeTurnsEstimate are NOT host product contracts.
// These tests keep the scope-progress *package* historical durable/advisor-queue behavior.
// New lifecycle voice: wanxiangli/scope-retention + common law «Scope». Do not re-wire todowrite schema to estimates.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { advisorClaim, advisorStageBegin, advisorStageConfirm, advisorPending } from 'wanxiangli/scope-progress'

const inDatabase = async fn => {
  const dir = mkdtempSync(join(tmpdir(), 'wxs-advisor-stages-'))
  const db = join(dir, 'advisor.sqlite')
  const use = action => {
    const journal = new SqliteJournal(new DatabaseSync(db))
    try { return action(journal) } finally { journal.close() }
  }
  try { await fn(use) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('SPEC[scope-progress-005] a committed stage request is not issued twice after cold reopen', async () => inDatabase(use => {
  assert.equal(use(j => advisorClaim(j, 'session', 'scope', 'report', 'issue')).status, 'Committed')
  const first = use(j => advisorStageBegin(j, 'session', 'scope', 'process', 1, 'what is wrong?', ['report']))
  assert.deepEqual([first.ok, first.start, first.status], [true, true, 'Committed'])
  const unknown = use(j => advisorStageBegin(j, 'session', 'scope', 'process', 1, 'what is wrong?', ['report']))
  assert.deepEqual([unknown.ok, unknown.start, unknown.status], [false, false, 'Unknown'])
  assert.equal(use(j => advisorStageBegin(j, 'session', 'scope', 'process', 2, 'what background?', ['report'])).ok, false,
    'a second paid request cannot start until the first response is proven')
  const unreserved = use(j => advisorStageConfirm(j, 'session', 'scope', 'process', 2, 'invented response'))
  assert.equal(unreserved.ok, false)
  assert.equal(use(j => advisorStageConfirm(j, 'session', 'scope', 'process', 1, 'real reply')).status, 'Committed')
  const recovered = use(j => advisorStageBegin(j, 'session', 'scope', 'process', 1, 'what is wrong?', ['report']))
  assert.equal(recovered.confirmed, true)
  assert.equal(recovered.start, false)
  assert.equal(recovered.prose, 'real reply')
  assert.equal(use(j => advisorStageConfirm(j, 'session', 'scope', 'process', 1, 'different reply')).status, 'Conflict')
  assert.equal(use(j => advisorStageBegin(j, 'session', 'scope', 'process', 1, 'different question', ['report'])).status, 'Conflict')
  assert.equal(use(j => advisorStageBegin(j, 'session', 'scope', 'process', 2, 'what background?', ['report'])).start, true)
}))

test('SPEC[scope-progress-005] after four confirmed answers the physical steer is independently reserved', async () => inDatabase(use => {
  use(j => advisorClaim(j, 'session', 'scope', 'report', 'issue'))
  for (let phase = 1; phase <= 4; phase++) {
    assert.equal(use(j => advisorStageBegin(j, 'session', 'scope', 'process', phase, 'prompt-' + phase, ['report'])).start, true)
    assert.equal(use(j => advisorStageConfirm(j, 'session', 'scope', 'process', phase, 'prose-' + phase)).ok, true)
  }
  assert.equal(use(j => advisorStageBegin(j, 'session', 'scope', 'process', 5, 'final advice', ['report'])).start, true)
  const unknown = use(j => advisorStageBegin(j, 'session', 'scope', 'process', 5, 'final advice', ['report']))
  assert.equal(unknown.status, 'Unknown', 'a possibly delivered steer cannot be resubmitted')
  assert.equal(use(j => advisorStageConfirm(j, 'session', 'scope', 'process', 5, 'final advice')).status, 'Committed')
  assert.equal(use(j => advisorStageBegin(j, 'session', 'scope', 'process', 5, 'final advice', ['report'])).confirmed, true)
  assert.equal(use(j => advisorPending(j, 'session', 'scope')).pending.length, 1,
    'a physical steer proof is not the Finished terminal fact')
}))

test('SPEC[scope-progress-005] Unknown and definite CAS contention cannot authorize a duplicate provider stage', async () => inDatabase(use => {
  use(j => advisorClaim(j, 'session', 'scope', 'report', 'issue'))
  const journal = {
    read: stream => use(j => j.read(stream)),
    append: (stream, revision, requestId, body) => {
      if (!journal.contended) {
        journal.contended = true
        const rival = use(j => advisorStageBegin(j, 'session', 'scope', 'process', 1, 'original', ['report']))
        assert.equal(rival.status, 'Committed')
      }
      return use(j => j.append(stream, revision, requestId, body))
    },
    contended: false,
  }
  const contested = advisorStageBegin(journal, 'session', 'scope', 'process', 1, 'original', ['report'])
  assert.deepEqual([contested.ok, contested.start, contested.status], [false, false, 'Unknown'])
  const damaged = { read: () => ['{"kind":"Admitted","scope":"scope","report":"report"}'], append: () => ({status: 'Unknown', reason: 'COMMIT indeterminate'}) }
  assert.equal(advisorStageBegin(damaged, 'session', 'scope', 'process', 1, 'other', ['report']).status, 'Unknown')
}))


test('SPEC[scope-progress-005] stage group members cannot be reassigned to a second Process', async () => inDatabase(use => {
  use(j => advisorClaim(j, 'session', 'scope', 'one', 'question-one'))
  use(j => advisorClaim(j, 'session', 'scope', 'two', 'question-two'))
  const first = use(j => advisorStageBegin(j, 'session', 'scope', 'first-process', 1, 'question-one\nquestion-two', ['one','two']))
  assert.equal(first.status, 'Committed')
  assert.equal(use(j => advisorStageBegin(j, 'session', 'scope', 'another-process', 1, 'question-two', ['two'])).status, 'Conflict')
  assert.equal(use(j => advisorStageBegin(j, 'session', 'scope', 'first-process', 1, 'question-one\nquestion-two', ['one'])).status, 'Conflict')
  const observed = use(j => advisorPending(j, 'session', 'scope'))
  assert.deepEqual(observed.pending.map(x => x.group.reportIds), [['one','two'], ['one','two']])
}))
