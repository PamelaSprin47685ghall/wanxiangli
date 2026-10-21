import test from 'node:test'
import assert from 'node:assert/strict'

import { IntegrationLaw } from 'wanxiangli/integration'

const law = new IntegrationLaw()
const plain = (v) => JSON.parse(JSON.stringify(v))
const rw = (evidence) => plain(law.reconcileWorktree({ jobId: 'j1', identity: 'manager/j1', path: '/w/j1', evidence }))
const own = { jobId: 'j1', path: '/w/j1' }
const ready = { rebasedCommit: 'r1', targetHeadSnapshot: 't1' }

test('SPEC[integration-1] commission binding: durable intent decides, physical evidence only resolves Requested', () => {
  assert.deepEqual(rw({ kind: 'NoDurableEffect' }), { decision: 'RequestThenCreate' })
  assert.deepEqual(rw({ kind: 'CreatedReceipt', ...own }), { decision: 'AdoptCreated' })
  assert.deepEqual(rw({ kind: 'RequestedEntries', ...own, entries: [] }), { decision: 'CreateAfterProvenMissing' })
  assert.deepEqual(
    rw({ kind: 'RequestedEntries', ...own, entries: [{ path: '/repo', identity: 'main' }, { path: '/w/j1', identity: 'manager/j1' }] }),
    { decision: 'AdoptThenRecordCreated' })
  assert.deepEqual(rw({ kind: 'RequestedQueryFailure', ...own, error: 'boom' }), { decision: 'Reject', reason: 'WorktreeQueryFailed', error: 'boom' })
})

test('SPEC[integration-1] counterexample: a reused name or path never adopts another job\'s directory', () => {
  const conflict = { decision: 'Reject', reason: 'DurableOwnershipConflict' }
  assert.deepEqual(rw({ kind: 'CreatedReceipt', jobId: 'j2', path: '/w/j1' }), conflict)
  assert.deepEqual(rw({ kind: 'CreatedReceipt', jobId: 'j1', path: '/w/other' }), conflict)
  assert.deepEqual(rw({ kind: 'RequestedConflict', ...own }), conflict)
  assert.deepEqual(rw({ kind: 'RequestedEntries', jobId: 'j2', path: '/w/j1', entries: [] }), conflict)
  assert.deepEqual(rw({ kind: 'RequestedQueryFailure', jobId: 'j2', path: '/w/j1', error: 'x' }), conflict)
  const physical = { decision: 'Reject', reason: 'PhysicalIdentityPathConflict' }
  assert.deepEqual(rw({ kind: 'RequestedEntries', ...own, entries: [{ path: '/w/j1', identity: 'manager/j2' }] }), physical)
  assert.deepEqual(rw({ kind: 'RequestedEntries', ...own, entries: [{ path: '/w/elsewhere', identity: 'manager/j1' }] }), physical)
  assert.deepEqual(rw({ kind: 'RequestedEntries', ...own, entries: [{ path: '/w/j1', identity: null }] }), physical)
  assert.throws(() => rw({ kind: 'Guess' }), /malformed evidence.kind/)
})

test('SPEC[integration-2] integration gate: only the pinned candidate on the CAS head publishes', () => {
  assert.deepEqual(plain(law.admitCandidate({ candidate: 'r1', target: 't1', rebased: ready })), { step: 'PublishCertified' })
  assert.deepEqual(plain(law.admitCandidate({ candidate: 'r1', target: 't2', rebased: ready })), { step: 'Rebase', reason: 'TargetAdvanced' })
  assert.deepEqual(plain(law.admitCandidate({ candidate: 'c9', target: 't1', rebased: ready })), { step: 'Rebase', reason: 'TargetAdvanced' })
  assert.deepEqual(plain(law.admitCandidate({ candidate: 'r1', target: 't1', rebased: null })), { step: 'Rebase', reason: 'InitialRebaseRequired' })
  assert.deepEqual(plain(law.certify({ candidate: 'r1', expectedHead: 't1', rebased: ready })), { ok: true })
  assert.deepEqual(plain(law.certify({ candidate: 'x', expectedHead: 'y', rebased: ready })), { ok: false, code: 'CandidatePin' })
  assert.deepEqual(plain(law.certify({ candidate: 'r1', expectedHead: 'y', rebased: ready })), { ok: false, code: 'SnapshotPin' })
  assert.deepEqual(plain(law.certify({ candidate: 'r1', expectedHead: 't1', rebased: null })), { ok: false, code: 'MissingRebased' })
  const pub = (evidence, current) => plain(law.checkPublication({ jobId: 'j1', jobTargetRef: 'main', evidence, current }))
  assert.deepEqual(pub({ jobId: 'j1', targetRef: 'main', expectedHead: 't1' }, 't1'), { ok: true })
  assert.deepEqual(pub({ jobId: 'j2', targetRef: 'dev', expectedHead: 'x' }, 't1'), { ok: false, code: 'JobMismatch' })
  assert.deepEqual(pub({ jobId: 'j1', targetRef: 'dev', expectedHead: 'x' }, 't1'), { ok: false, code: 'TargetMismatch' })
  assert.deepEqual(pub({ jobId: 'j1', targetRef: 'main', expectedHead: 'x' }, 't1'), { ok: false, code: 'CasMismatch' })
})

test('SPEC[integration-2] counterexample: a moved target is a retryable miss, a foreign landing is never success', () => {
  const ff = (merge) => plain(law.ffMerge({ merge, candidate: 'r1', targetMovedError: 'target ref moved' }))
  assert.deepEqual(ff({ ok: true, landed: 'r1' }), { outcome: 'Landed', landed: 'r1' })
  assert.deepEqual(ff({ ok: true, landed: 'zz' }), { outcome: 'LandedMismatch', landed: 'zz' })
  assert.deepEqual(ff({ ok: false, error: 'target ref moved' }), { outcome: 'TargetMoved' })
  assert.deepEqual(ff({ ok: false, error: 'Target ref moved' }), { outcome: 'Failed', error: 'Target ref moved' })
})

test('SPEC[integration-3] conflict ownership: unmerged files are this job\'s conflict; none means no conflict', () => {
  const r = law.rebaseFailed({ conflictFiles: ['a.txt', 'b/c.txt'] })
  assert.deepEqual(plain(r), { step: 'RecordConflict', files: ['a.txt', 'b/c.txt'] })
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.files))
  assert.deepEqual(plain(law.rebaseFailed({ conflictFiles: [] })), { step: 'Fail' })
  assert.throws(() => law.rebaseFailed({ conflictFiles: [1] }), /malformed conflictFiles/)
})

test('SPEC[integration-4] crash recovery resumes from the last durable fact, never from disk state', () => {
  assert.deepEqual(plain(law.resume({ record: null })), { step: 'RunLoop' })
  assert.deepEqual(plain(law.resume({ record: { terminal: true, claimed: true } })), { step: 'CleanUp' })
  assert.deepEqual(plain(law.resume({ record: { terminal: false, claimed: true } })), { step: 'ReenterClaim' })
  assert.deepEqual(plain(law.resume({ record: { terminal: false, claimed: false } })), { step: 'RunLoop' })
  const claim = { targetRef: 'main', rebasedCommit: 'r1', expectedHead: 't1' }
  const re = (c, record) => plain(law.reenterClaim({ jobTargetRef: 'main', claim: c, record }))
  assert.deepEqual(re(claim, { rebased: ready }), { step: 'VerifyHead' })
  assert.deepEqual(re({ ...claim, targetRef: 'dev' }, { rebased: ready }), { step: 'Refuse', reason: 'TargetMismatch' })
  assert.deepEqual(re(claim, null), { step: 'Refuse', reason: 'MissingRecord' })
  assert.deepEqual(re(claim, { rebased: null }), { step: 'Refuse', reason: 'MissingRebased' })
  assert.deepEqual(re(claim, { rebased: { rebasedCommit: 'r2', targetHeadSnapshot: 't1' } }), { step: 'RunLoop' })
  assert.deepEqual(re(claim, { rebased: { rebasedCommit: 'r1', targetHeadSnapshot: 't2' } }), { step: 'RunLoop' })
  const pc = (head) => plain(law.publishClaim({ head, rebasedCommit: 'r1', expectedHead: 't1' })).reality
  assert.deepEqual([null, 'r1', 't1', 'zz'].map(pc), ['HeadUnreadable', 'AlreadyFastForwarded', 'PublishReady', 'ClaimExpired'])
  // already-published wins even when the expectation equals the candidate
  assert.equal(plain(law.publishClaim({ head: 'r1', rebasedCommit: 'r1', expectedHead: 'r1' })).reality, 'AlreadyFastForwarded')
  const rc = (head) => plain(law.rebasedCandidate({ head, rebasedCommit: 'r1', targetHeadSnapshot: 't1' })).reality
  assert.deepEqual([null, 't1', 'r1'].map(rc), ['HeadUnreadable', 'PublishReady', 'NeedsRebase'])
})
