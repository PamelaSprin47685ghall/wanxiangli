import test from 'node:test'
import assert from 'node:assert/strict'

import { HandleLifecycleLaw } from 'wanxiangli/handle-lifecycle'

const law = new HandleLifecycleLaw()
const plain = (v) => JSON.parse(JSON.stringify(v))
const h = (event, phase, extra = {}) => plain(law.handle({ event, phase, ...extra }))
const w = (event, phase, extra = {}) => plain(law.work({ event, phase, legacy: false, ...extra }))
const set = (phase) => ({ verdict: 'set', phase })
const no = (rejection) => ({ verdict: 'reject', rejection })
const full = { kind: 'Terminal', hasRef: true, hasDigest: true }
const cancelled = { kind: 'Cancelled', hasRef: false, hasDigest: false }

test('SPEC[handle-lifecycle-1] handle: first terminal wins, later arrivals are refused in a fixed order', () => {
  assert.deepEqual(h('complete', 'Active'), set('CompletedAwaitingJoin'))
  assert.deepEqual(h('complete', 'CompletedAwaitingJoin'), no('AlreadyCompleted'))
  assert.deepEqual(h('complete', 'Abandoned'), no('AlreadyAbandoned'))
  assert.deepEqual(h('complete', 'Retired'), no('HandleIsRetired'))
  assert.deepEqual(h('complete', null), no('UnknownHandle'))
  assert.deepEqual(h('abandon', 'Active'), set('Abandoned'))
  assert.deepEqual(h('abandon', 'CompletedAwaitingJoin'), set('Abandoned'))
  assert.deepEqual(h('abandon', 'Abandoned'), no('AlreadyAbandoned'))
})

test('SPEC[handle-lifecycle-1] counterexample: join cannot retire an Active handle; a reportable terminal retires once', () => {
  assert.deepEqual(h('retire', 'Active'), no('NotCompleted'))
  assert.deepEqual(h('retire', 'CompletedAwaitingJoin'), set('Retired'))
  assert.deepEqual(h('retire', 'Abandoned'), set('Retired'))
  assert.deepEqual(h('retire', 'Retired'), no('HandleIsRetired'))
})

test('SPEC[handle-lifecycle-2] a false completion is revoked only on an exact cell match', () => {
  assert.deepEqual(h('rejectFalseCompletion', 'CompletedAwaitingJoin', { cellMatches: true }), set('Active'))
  assert.deepEqual(h('rejectFalseCompletion', 'CompletedAwaitingJoin', { cellMatches: false }), no('AlreadyCompleted'))
  assert.deepEqual(h('rejectFalseCompletion', 'Active', { cellMatches: false }), { verdict: 'keep' })
  assert.deepEqual(h('rejectFalseCompletion', 'Abandoned', { cellMatches: true }), no('AlreadyAbandoned'))
})

test('SPEC[handle-lifecycle-3] work: lookups first, completion needs a real payload', () => {
  assert.deepEqual(w('complete', null, { completion: full }), no('WorkNotAdmitted'))
  assert.deepEqual(w('complete', 'Active', { legacy: true, completion: full }), no('LegacyWorkAmbiguous'))
  assert.deepEqual(w('complete', 'Active', { completion: full }), set('CompletedAwaitingJoin'))
  assert.deepEqual(w('complete', 'Active', { completion: { ...full, kind: 'Cancelled' } }), no('NotCompleted'))
  assert.deepEqual(w('complete', 'Active', { completion: { ...full, hasDigest: false } }), no('NotCompleted'))
  assert.deepEqual(w('abandon', 'Active'), set('Abandoned'))
  assert.deepEqual(w('void', 'Active'), set('Retired'))
  assert.deepEqual(w('void', 'CompletedAwaitingJoin'), no('AlreadyCompleted'))
})

test('SPEC[handle-lifecycle-3] counterexample: an old handle cannot settle new work; consumption is exact and once', () => {
  const c = (phase, extra) => w('consume', phase, { consumptionId: 'k', expected: full, cellEqualsExpected: false, ...extra })
  assert.deepEqual(c('CompletedAwaitingJoin', { cellEqualsExpected: true }), set('Retired'))
  assert.deepEqual(c('CompletedAwaitingJoin', {}), no('ConsumptionMismatch'))
  assert.deepEqual(c('CompletedAwaitingJoin', { cellEqualsExpected: true, consumptionId: '  ' }), no('ConsumptionMismatch'))
  assert.deepEqual(c('Abandoned', { expected: cancelled }), set('Retired'))
  assert.deepEqual(c('Abandoned', {}), no('ConsumptionMismatch'))
  assert.deepEqual(c('Retired', { cellEqualsExpected: true }), no('HandleIsRetired'))
  assert.deepEqual(c('Active', {}), no('NotCompleted'))
  assert.deepEqual(c('Active', { consumptionId: null }), no('ConsumptionMismatch'))
})

test('SPEC[handle-lifecycle-1] malformed input is refused and verdicts are frozen', () => {
  assert.throws(() => law.handle(null), /input/)
  assert.throws(() => h('finish', 'Active'), /event/)
  assert.throws(() => h('complete', 'Done'), /phase/)
  assert.throws(() => h('rejectFalseCompletion', 'CompletedAwaitingJoin'), /cellMatches/)
  assert.throws(() => law.work({ event: 'void', phase: 'Active' }), /legacy/)
  assert.throws(() => w('complete', 'Active', { completion: { kind: 'Other', hasRef: true, hasDigest: true } }), /completion.kind/)
  assert.ok(Object.isFrozen(law.handle({ event: 'complete', phase: 'Active' })))
})

const r = (over) => plain(law.recoverChild({ durable: 'Active', snapshot: 'Missing', observations: [], proofError: null, ...over }))
test('SPEC[handle-lifecycle-4] durable facts decide before any Host snapshot', () => {
  assert.deepEqual(r({ durable: 'Abandoned', durableReason: 'DeadlineExceeded', snapshot: 'Terminal' }), { resolution: 'abandoned', reason: 'DeadlineExceeded', source: 'durable' })
  assert.deepEqual(r({ durable: 'CompletedAwaitingJoin', observations: ['ParentCancelled'] }), { resolution: 'terminal', source: 'durable' })
  assert.deepEqual(r({ durable: 'Retired', snapshot: 'Terminal' }), { resolution: 'blocked', reason: 'handle already retired' })
})

test('SPEC[handle-lifecycle-4] counterexample: an abort observation is never a completion, an unreadable snapshot only waits', () => {
  assert.deepEqual(r({ observations: ['AbortedObserved'] }), { resolution: 'incomplete' })
  assert.deepEqual(r({ observations: ['RecoveryInFlight'] }), { resolution: 'incomplete' })
  assert.deepEqual(r({ snapshot: 'Unreadable', observations: ['SessionActive', 'HostSessionGone'] }), { resolution: 'incomplete' })
  assert.deepEqual(r({ snapshot: 'Terminal', proofError: 'mismatch' }), { resolution: 'blocked', reason: 'mismatch' })
  assert.deepEqual(r({ durable: 'Unknown', snapshot: 'Terminal' }), { resolution: 'terminal', source: 'snapshot' })
})

test('SPEC[handle-lifecycle-4] the first proven abandonment wins over a live session', () => {
  assert.deepEqual(r({ snapshot: 'Active', observations: ['SessionActive', 'HostSessionGone', 'ParentCancelled'] }), { resolution: 'abandoned', reason: 'HostSessionGone', source: 'observation' })
  assert.deepEqual(r({ snapshot: 'Active', observations: ['AbortedObserved', 'SessionActive'] }), { resolution: 'active' })
  assert.throws(() => r({ observations: ['Done'] }), /observations/)
  assert.throws(() => r({ durable: 'Abandoned', durableReason: 'Other' }), /durableReason/)
  assert.throws(() => r({ snapshot: 'Gone' }), /snapshot/)
})
