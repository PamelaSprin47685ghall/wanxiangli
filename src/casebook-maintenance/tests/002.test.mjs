import test from 'node:test'
import assert from 'node:assert/strict'

import { CasebookSettlementOwner } from 'wanxiangli/casebook-maintenance'

test('SPEC[settlement-owner-1] onConflict requires non-null callback and rejects null/undefined', () => {
  assert.throws(() => new CasebookSettlementOwner(null), /onConflict/)
  assert.throws(() => new CasebookSettlementOwner(undefined), /onConflict/)
})

test('SPEC[settlement-owner-2] StorageInvalid first observation triggers onConflict and returns LogScopeFailure', () => {
  const conflicts = []
  const owner = new CasebookSettlementOwner(incident => conflicts.push(incident))
  const incident = { id: 1, name: 'failure-1' }

  const outcome1 = owner.Observe('ev-1', 'StorageInvalid', incident)
  assert.equal(outcome1, 'LogScopeFailure')
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0], incident)

  // Duplicate same eventId does not trigger onConflict again, but still returns LogScopeFailure
  const incidentRepeat = { id: 1, name: 'failure-1-diff-ref' }
  const outcome2 = owner.Observe('ev-1', 'StorageInvalid', incidentRepeat)
  assert.equal(outcome2, 'LogScopeFailure')
  assert.equal(conflicts.length, 1)
})

test('SPEC[settlement-owner-3] SemanticCut first returns CaseUnavailable and repeats return CaseUnavailableKnown', () => {
  const conflicts = []
  const owner = new CasebookSettlementOwner(incident => conflicts.push(incident))
  const incident = { id: 2, name: 'cut-candidate' }

  const outcome1 = owner.Observe('ev-2', 'SemanticCut', incident)
  assert.equal(outcome1, 'CaseUnavailable')
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0], incident)

  // Re-observing the same eventId returns CaseUnavailableKnown without firing onConflict
  const outcome2 = owner.Observe('ev-2', 'SemanticCut', incident)
  assert.equal(outcome2, 'CaseUnavailableKnown')
  assert.equal(conflicts.length, 1)
})

test('SPEC[settlement-owner-4] onConflict throwing exceptions is swallowed without altering outcome or registered state', () => {
  let callCount = 0
  const owner = new CasebookSettlementOwner(() => {
    callCount += 1
    throw new Error('boom in callback')
  })
  const incident = { id: 3, name: 'throwing-callback' }

  assert.doesNotThrow(() => {
    const outcome1 = owner.Observe('ev-3', 'SemanticCut', incident)
    assert.equal(outcome1, 'CaseUnavailable')
  })
  assert.equal(callCount, 1)

  // State was still registered despite the exception
  const outcome2 = owner.Observe('ev-3', 'SemanticCut', incident)
  assert.equal(outcome2, 'CaseUnavailableKnown')
  assert.equal(callCount, 1)
})

test('SPEC[settlement-owner-5] Redeliver returns CaseUnavailableKnown for identical reference and rejects non-settled incidents', () => {
  const owner = new CasebookSettlementOwner(() => {})
  const incident = { id: 4, name: 'original-ref' }

  owner.Observe('ev-4', 'SemanticCut', incident)

  // Same reference -> success
  const outcome = owner.Redeliver('ev-4', incident)
  assert.equal(outcome, 'CaseUnavailableKnown')

  // Stranger reference with same content -> rejected
  const stranger = { id: 4, name: 'original-ref' }
  assert.throws(
    () => owner.Redeliver('ev-4', stranger),
    /A Casebook incident must come from its original settled owner/
  )

  // Unknown eventId -> rejected
  assert.throws(
    () => owner.Redeliver('ev-unknown', incident),
    /A Casebook incident must come from its original settled owner/
  )
})

test('SPEC[settlement-owner-6] Unscoped does not trigger onConflict and does not claim eventId', () => {
  const conflicts = []
  const owner = new CasebookSettlementOwner(incident => conflicts.push(incident))

  const outcome = owner.Observe('ev-5', 'Unscoped', null)
  assert.equal(outcome, 'Unscoped')
  assert.equal(conflicts.length, 0)

  // Subsequent SemanticCut for the same eventId is still treated as first delivery
  const cutIncident = { id: 5, name: 'real-cut' }
  const cutOutcome = owner.Observe('ev-5', 'SemanticCut', cutIncident)
  assert.equal(cutOutcome, 'CaseUnavailable')
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0], cutIncident)
})

test('SPEC[settlement-owner-7] multiple instances maintain strict state isolation', () => {
  const conflicts1 = []
  const conflicts2 = []
  const owner1 = new CasebookSettlementOwner(inc => conflicts1.push(inc))
  const owner2 = new CasebookSettlementOwner(inc => conflicts2.push(inc))

  const incident = { id: 6, name: 'shared-ev' }

  const o1 = owner1.Observe('ev-6', 'SemanticCut', incident)
  assert.equal(o1, 'CaseUnavailable')
  assert.equal(conflicts1.length, 1)
  assert.equal(conflicts2.length, 0)

  // owner2 sees ev-6 for the first time independently
  const o2 = owner2.Observe('ev-6', 'SemanticCut', incident)
  assert.equal(o2, 'CaseUnavailable')
  assert.equal(conflicts2.length, 1)

  // Redeliver across owners: incident settled by owner1 cannot be redelivered by owner3
  const owner3 = new CasebookSettlementOwner(() => {})
  assert.throws(
    () => owner3.Redeliver('ev-6', incident),
    /A Casebook incident must come from its original settled owner/
  )
})
