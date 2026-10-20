import test from 'node:test'
import assert from 'node:assert/strict'

import { ChatExecutionLaw } from 'wanxiangli/chat-execution'

const law = new ChatExecutionLaw()
const A = { phase: 'Accepted' }
const S = { phase: 'ProviderStarted' }
const B = (disposition) => ({ phase: 'EndedBeforeStart', disposition })
const E = (disposition) => ({ phase: 'EndedAfterStart', disposition })
const plain = (v) => JSON.parse(JSON.stringify(v))
const fold = (current, fact) => plain(law.fold(current, { schemaVersion: 1, sameAccepted: true, sameStarted: true, ...fact }))

test('SPEC[chat-execution-1] Accepted: first fact sets, exact replay keeps, different evidence is rejected', () => {
  assert.deepEqual(fold(null, { kind: 'Accepted' }), { verdict: 'set', next: A })
  for (const current of [A, S, B('Failed'), E('Completed')]) {
    assert.deepEqual(fold(current, { kind: 'Accepted' }), { verdict: 'keep' })
    assert.equal(fold(current, { kind: 'Accepted', sameAccepted: false }).verdict, 'reject')
  }
})

test('SPEC[chat-execution-1] counterexample: a duplicate ProviderStarted is idempotent only for the same run, never after a terminal', () => {
  assert.deepEqual(fold(A, { kind: 'ProviderStarted', sameStarted: false }), { verdict: 'set', next: S })
  assert.deepEqual(fold(S, { kind: 'ProviderStarted' }), { verdict: 'keep' })
  assert.match(fold(S, { kind: 'ProviderStarted', sameStarted: false }).reason, /does not match/)
  assert.match(fold(A, { kind: 'ProviderStarted', sameAccepted: false }).reason, /does not match/)
  assert.match(fold(null, { kind: 'ProviderStarted' }).reason, /no preceding Accepted/)
  for (const ended of [B('Cancelled'), E('Completed')])
    assert.equal(fold(ended, { kind: 'ProviderStarted' }).reason, 'InvalidFact: ProviderStarted cannot follow a Terminal fact')
})

test('SPEC[chat-execution-1] counterexample: Terminal is single-assigned; an old terminal cannot be overwritten; a pre-start Completed is impossible', () => {
  const T = (evidence, disposition, extra = {}) => ({ kind: 'Terminal', evidence, disposition, ...extra })
  assert.deepEqual(fold(A, T('PreProvider', 'Cancelled')), { verdict: 'set', next: B('Cancelled') })
  assert.match(fold(A, T('PreProvider', 'Completed')).reason, /attempts Completed/)
  assert.match(fold(A, T('AfterProviderStart', 'Completed')).reason, /no preceding ProviderStarted/)
  assert.deepEqual(fold(S, T('AfterProviderStart', 'Completed')), { verdict: 'set', next: E('Completed') })
  assert.match(fold(S, T('AfterProviderStart', 'Completed', { sameStarted: false })).reason, /does not match ProviderStarted/)
  assert.match(fold(S, T('PreProvider', 'Failed')).reason, /cannot follow ProviderStarted/)
  assert.deepEqual(fold(B('Failed'), T('PreProvider', 'Failed')), { verdict: 'keep' })
  assert.deepEqual(fold(E('Rejected'), T('AfterProviderStart', 'Rejected')), { verdict: 'keep' })
  const conflict = "InvalidFact: Terminal conflicts with the execution's established evidence or disposition"
  assert.equal(fold(B('Failed'), T('PreProvider', 'Cancelled')).reason, conflict)
  assert.equal(fold(B('Failed'), T('PreProvider', 'Failed', { sameAccepted: false })).reason, conflict)
  assert.equal(fold(B('Failed'), T('AfterProviderStart', 'Failed')).reason, conflict)
  assert.equal(fold(E('Completed'), T('AfterProviderStart', 'Failed')).reason, conflict)
  assert.equal(fold(E('Completed'), T('PreProvider', 'Completed')).reason, conflict)
  assert.equal(fold(null, T('PreProvider', 'Failed')).reason, 'InvalidFact: Terminal has no preceding Accepted fact')
})

test('SPEC[chat-execution-1] the schema is judged before any evidence, and malformed input is refused', () => {
  assert.equal(law.schemaRejection(1), null)
  assert.equal(law.schemaRejection(2), 'UnsupportedSchema: expected 1, received 2')
  assert.deepEqual(plain(law.fold(A, { kind: 'Terminal', schemaVersion: 0 })), { verdict: 'reject', reason: 'UnsupportedSchema: expected 1, received 0' })
  assert.throws(() => law.fold(A, { kind: 'Accepted', schemaVersion: 1 }), /sameAccepted/)
  assert.throws(() => law.fold({ phase: 'Done' }, { kind: 'Accepted', schemaVersion: 1, sameAccepted: true }), /phase/)
  assert.throws(() => law.fold(B('Completed'), { kind: 'Accepted', schemaVersion: 1, sameAccepted: true }), /cannot be Completed/)
  assert.throws(() => law.fold(A, { kind: 'Other', schemaVersion: 1 }), /kind/)
  assert.throws(() => law.fold(A, null), /fact/)
  assert.throws(() => law.schemaRejection('1'), /schemaVersion/)
  assert.ok(Object.isFrozen(law.fold(null, { kind: 'Accepted', schemaVersion: 1, sameAccepted: true })))
})

test('SPEC[chat-execution-2] provider start: append once, replay the same run, refuse another run and any start after a terminal', () => {
  assert.deepEqual(plain(law.decideStart(A, false)), { verdict: 'append' })
  assert.deepEqual(plain(law.decideStart(S, true)), { verdict: 'existing' })
  assert.deepEqual(plain(law.decideStart(S, false)), { verdict: 'providerRunConflict' })
  assert.deepEqual(plain(law.decideStart(B('Rejected'), false)), { verdict: 'startedAfterTerminal', established: 'Rejected' })
  assert.deepEqual(plain(law.decideStart(E('Completed'), true)), { verdict: 'startedAfterTerminal', established: 'Completed' })
  assert.throws(() => law.decideStart(null, true), /accepted/)
})

test('SPEC[chat-execution-2] after-provider terminal: one disposition, exact replay, the run is checked before the disposition', () => {
  assert.deepEqual(plain(law.decideTerminal(A, false, 'Completed')), { verdict: 'providerNotStarted' })
  assert.deepEqual(plain(law.decideTerminal(S, true, 'Completed')), { verdict: 'append' })
  assert.deepEqual(plain(law.decideTerminal(S, false, 'Completed')), { verdict: 'providerRunConflict' })
  assert.deepEqual(plain(law.decideTerminal(B('Failed'), false, 'Failed')), { verdict: 'projectionConflict' })
  assert.deepEqual(plain(law.decideTerminal(E('Failed'), true, 'Failed')), { verdict: 'existing' })
  assert.deepEqual(plain(law.decideTerminal(E('Failed'), true, 'Completed')), { verdict: 'terminalConflict', established: 'Failed' })
  assert.deepEqual(plain(law.decideTerminal(E('Failed'), false, 'Completed')), { verdict: 'providerRunConflict' })
  assert.throws(() => law.decideTerminal(S, true, 'Done'), /disposition/)
})

test('SPEC[chat-execution-2] counterexample: pre-provider settlement never completes, never settles a started execution, settles once', () => {
  assert.deepEqual(plain(law.settlePreProvider(A, true, 'Completed')), { verdict: 'invalidDisposition' })
  assert.deepEqual(plain(law.settlePreProvider(null, true, 'Completed')), { verdict: 'invalidDisposition' }, 'the disposition is judged first')
  assert.deepEqual(plain(law.settlePreProvider(null, true, 'Failed')), { verdict: 'missingAccepted' })
  assert.deepEqual(plain(law.settlePreProvider(S, false, 'Failed')), { verdict: 'evidenceConflict' })
  assert.deepEqual(plain(law.settlePreProvider(A, true, 'Cancelled')), { verdict: 'append' })
  assert.deepEqual(plain(law.settlePreProvider(S, true, 'Cancelled')), { verdict: 'providerAlreadyStarted' })
  assert.deepEqual(plain(law.settlePreProvider(B('Cancelled'), true, 'Cancelled')), { verdict: 'existing' })
  assert.deepEqual(plain(law.settlePreProvider(B('Cancelled'), true, 'Rejected')), { verdict: 'terminalConflict', established: 'Cancelled' })
  assert.deepEqual(plain(law.settlePreProvider(E('Completed'), true, 'Rejected')), { verdict: 'terminalConflict', established: 'Completed' })
})
