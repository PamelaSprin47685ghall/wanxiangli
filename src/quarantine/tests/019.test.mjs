import test from 'node:test'
import assert from 'node:assert/strict'

import { RuleQuarantine } from 'wanxiangli/quarantine'

const q = new RuleQuarantine()

test('SPEC[quarantine-1] the ledger is keyed by (rule, scope), persistent, and overwrites on re-quarantine', () => {
  const empty = q.empty()
  const one = q.quarantine(empty, 'Jobs', 'job/a', 'e1', 'boom')
  assert.equal(q.isQuarantined(empty, 'Jobs', 'job/a'), false, 'the old ledger is untouched')
  assert.equal(q.isQuarantined(one, 'Jobs', 'job/a'), true)
  assert.equal(q.isQuarantined(one, 'Jobs', 'job/b'), false, 'another scope of the same rule keeps advancing')
  assert.equal(q.isQuarantined(one, 'Plans', 'job/a'), false, 'another rule in the same scope keeps advancing')
  assert.deepEqual({ ...q.fault(one, 'Jobs', 'job/a') }, { failedEventId: 'e1', reason: 'boom' })
  assert.equal(q.fault(one, 'Jobs', 'job/b'), null)
  const again = q.quarantine(one, 'Jobs', 'job/a', 'e2', 'again')
  assert.deepEqual({ ...q.fault(again, 'Jobs', 'job/a') }, { failedEventId: 'e2', reason: 'again' })
  assert.deepEqual({ ...q.fault(one, 'Jobs', 'job/a') }, { failedEventId: 'e1', reason: 'boom' })
  const released = q.release(again, 'Jobs', 'job/a')
  assert.equal(q.isQuarantined(released, 'Jobs', 'job/a'), false)
  assert.equal(q.isQuarantined(again, 'Jobs', 'job/a'), true)
  assert.equal(q.size(q.release(released, 'Jobs', 'missing')), 0, 'releasing an absent key is a no-op')
  // keys never collide through concatenation
  const tricky = q.quarantine(q.empty(), 'a/b', 'c', 'e', 'r')
  assert.equal(q.isQuarantined(tricky, 'a', 'b/c'), false)
  assert.throws(() => q.isQuarantined({}, 'r', 's'), /ledger/)
  assert.throws(() => q.quarantine(empty, 'r', 's', 1, 'x'), /failedEventId/)
})

test('SPEC[quarantine-2] cut-tail payload: fixed key order on the wire, strict decode, malformed is not a cut', () => {
  const cut = { rule: 'Jobs', failedEventId: 'e1', reason: 'boom', resetJson: '{"a":1}' }
  const wire = q.encodeCut(cut)
  assert.deepEqual(Object.keys(wire), ['rule', 'failed_event_id', 'reason', 'reset_json'])
  assert.equal(JSON.stringify(wire), '{"rule":"Jobs","failed_event_id":"e1","reason":"boom","reset_json":"{\\"a\\":1}"}')
  assert.deepEqual({ ...q.decodeCut('ProjectionCutTail', wire) }, cut)
  assert.deepEqual({ ...q.decodeCut('ProjectionCutTail', { ...wire, extra: 1 }) }, cut, 'extra fields are ignored')
  assert.deepEqual({ ...q.decodeCut('ProjectionCutTail', { rule: '', failed_event_id: '', reason: '', reset_json: '' }) }, { rule: '', failedEventId: '', reason: '', resetJson: '' })
  assert.equal(q.decodeCut('JobRequested', wire), null)
  assert.equal(q.decodeCut('projectioncuttail', wire), null)
  for (const bad of [null, [], 'x', 3, { ...wire, rule: 1 }, { ...wire, reset_json: null }, { rule: 'r', failed_event_id: 'e', reason: 'x' }])
    assert.equal(q.decodeCut('ProjectionCutTail', bad), null, JSON.stringify(bad))
  assert.equal(q.cutTailType, 'ProjectionCutTail')
  assert.throws(() => q.encodeCut({ ...cut, reason: undefined }), /reason/)
})

test('SPEC[quarantine-3] a cut takes effect only for a known rule whose failed event is integrated', () => {
  assert.equal(q.cutVerdict(true, 'job/a'), true)
  assert.equal(q.cutVerdict(true, ''), true, 'an empty scope is still a scope')
  assert.equal(q.cutVerdict(true, null), false, 'failed event not integrated')
  assert.equal(q.cutVerdict(false, 'job/a'), false, 'rule no longer in the program')
  assert.throws(() => q.cutVerdict('yes', 'x'), /ruleKnown/)
})
