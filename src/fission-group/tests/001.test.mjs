import test from 'node:test'
import assert from 'node:assert/strict'

import { FissionGroupLaw } from 'wanxiangli/fission-group'

const law = new FissionGroupLaw()
const j = (input) => JSON.parse(JSON.stringify(law.judge(input)))
const set = { verdict: 'set' }, keep = { verdict: 'keep' }
const no = (rejection) => ({ verdict: 'reject', rejection })
const done = { workedLanes: [0, 1], deliveries: [[1, 0]] }
const partial = { workedLanes: [0], deliveries: [[0, 1]] }
const undelivered = { workedLanes: [1, 0], deliveries: [[0]] }

test('SPEC[fission-group-1] the lane set is admitted whole, once per owner, with fixed lane count', () => {
  const a = (o) => j({ event: 'admitted', existing: null, laneCount: 2, sessionCount: 2, promptCount: 2, ownerActive: false, ...o })
  assert.deepEqual(a({}), set)
  assert.deepEqual(a({ existing: 'same', ownerActive: true }), keep)
  assert.deepEqual(a({ existing: 'different' }), no('ConflictingGroup'))
  assert.deepEqual(a({ laneCount: 1, sessionCount: 1, promptCount: 1 }), no('ConflictingGroup'))
  assert.deepEqual(a({ sessionCount: 3 }), no('ConflictingGroup'))
  assert.deepEqual(a({ ownerActive: true }), no('DuplicateOwnerActive'))
})

test('SPEC[fission-group-2] every lane cell has one value; a replacement sibling or a reordered lane is refused', () => {
  const m = (o) => j({ event: 'laneMaterialized', laneCount: 2, laneIndex: 1, laneSession: 'match', work: null, ...o })
  assert.deepEqual(m({}), set)
  assert.deepEqual(m({ work: 'same' }), keep)
  assert.deepEqual(m({ work: 'different' }), no('ConflictingLaneWork'))
  assert.deepEqual(m({ laneSession: 'mismatch' }), no('LaneSessionMismatch'))
  assert.deepEqual(m({ laneIndex: 2 }), no('InvalidLane'))
  assert.deepEqual(m({ laneIndex: -1, laneSession: 'mismatch' }), no('InvalidLane'))
  assert.deepEqual(m({ laneCount: null }), no('UnknownGroup'))
  assert.deepEqual(j({ event: 'completionCaptured', laneCount: 2, preFission: false, captured: null }), no('ConflictingGroup'))
  assert.deepEqual(j({ event: 'completionCaptured', laneCount: 2, preFission: true, captured: 'different' }), no('ConflictingGroup'))
  assert.deepEqual(j({ event: 'completionCaptured', laneCount: 2, preFission: true, captured: 'same' }), keep)
  assert.deepEqual(j({ event: 'completionDelivered', laneCount: 2, laneIndex: 0, captured: false }), no('ConflictingGroup'))
  assert.deepEqual(j({ event: 'completionDelivered', laneCount: 2, laneIndex: 0, captured: true }), set)
  assert.deepEqual(j({ event: 'externalAffinityBound', laneCount: 2, laneIndex: 0, bound: 'different' }), no('ConflictingGroup'))
  assert.deepEqual(j({ event: 'externalAffinityBound', laneCount: 2, laneIndex: 3, bound: null }), no('InvalidLane'))
})

test('SPEC[fission-group-3] no convergence before every lane worked and every pre-Fission completion reached every lane', () => {
  assert.equal(law.convergenceReady({ laneCount: 2, progress: done }), true)
  assert.equal(law.convergenceReady({ laneCount: 2, progress: partial }), false)
  assert.equal(law.convergenceReady({ laneCount: 2, progress: undelivered }), false)
  assert.equal(law.convergenceReady({ laneCount: 2, progress: { workedLanes: [0, 5], deliveries: [] } }), false)
  const t = (o) => j({ event: 'takeover', laneCount: 2, laneIndex: 0, laneSession: 'match', progress: done, takeover: null, ...o })
  assert.deepEqual(t({}), set)
  assert.deepEqual(t({ progress: partial }), no('ConvergenceIncomplete'))
  assert.deepEqual(t({ takeover: 'same' }), keep)
  assert.deepEqual(t({ takeover: 'different' }), no('ConflictingTakeover'))
  assert.deepEqual(t({ laneSession: 'absent' }), no('LaneSessionMismatch'))
  const c = (o) => j({ event: 'converged', laneCount: 2, terminal: 'Open', terminalSame: false, progress: done, takeoverLane: null, ...o })
  assert.deepEqual(c({}), set)
  assert.deepEqual(c({ takeoverLane: 'match' }), set)
  assert.deepEqual(c({ takeoverLane: 'mismatch' }), no('ConflictingTakeover'))
  assert.deepEqual(c({ progress: undelivered }), no('ConvergenceIncomplete'))
  assert.deepEqual(c({ terminal: 'Converged', terminalSame: true, progress: partial }), keep)
  assert.deepEqual(c({ terminal: 'Converged' }), no('TerminalAlreadySet'))
  assert.deepEqual(c({ terminal: 'Failed', terminalSame: true }), no('TerminalAlreadySet'))
  const f = (o) => j({ event: 'failed', laneCount: 2, terminal: 'Open', terminalSame: false, ...o })
  assert.deepEqual(f({}), set)
  assert.deepEqual(f({ terminal: 'Failed', terminalSame: true }), keep)
  assert.deepEqual(f({ terminal: 'Failed' }), no('TerminalAlreadySet'))
  assert.deepEqual(f({ terminal: 'Converged', terminalSame: true }), no('TerminalAlreadySet'))
})

test('SPEC[fission-group] results are frozen and malformed input is refused', () => {
  assert.ok(Object.isFrozen(law.judge({ event: 'failed', laneCount: 2, terminal: 'Open', terminalSame: false })))
  assert.throws(() => law.judge({ event: 'nope', laneCount: 2 }))
  assert.throws(() => law.judge({ event: 'laneMaterialized', laneCount: 2, laneIndex: 0, laneSession: 'maybe', work: null }))
  assert.throws(() => law.judge({ event: 'takeover', laneCount: 2, laneIndex: 0, laneSession: 'match', progress: { workedLanes: 'x', deliveries: [] }, takeover: null }))
})

test('SPEC[fission-group-4] the lane request is canonical: two or more lanes, none blank, lane i is prompt i', () => {
  const p = (xs) => JSON.parse(JSON.stringify(law.parsePrompts(xs)))
  assert.deepEqual(p(['a']), { rejection: 'TooFewLanes' })
  assert.deepEqual(p([]), { rejection: 'TooFewLanes' })
  assert.deepEqual(p(['a', ' \t']), { rejection: 'EmptyLanePrompt', index: 1 })
  assert.deepEqual(p(['', 'b', '']), { rejection: 'EmptyLanePrompt', index: 0 })
  assert.deepEqual(p(['a', 'b', 'c']), { lanes: 3 })
})

test('SPEC[fission-group-5] routing, ring order and the final lane are topology, not arrival', () => {
  const plain = (v) => JSON.parse(JSON.stringify(v))
  assert.deepEqual(plain(law.routeCompletion({ laneCount: 3, lane: null })), [0, 1, 2])
  assert.deepEqual(plain(law.routeCompletion({ laneCount: 3, lane: 2 })), [2])
  assert.deepEqual(plain(law.routeCompletion({ laneCount: 3, lane: 3 })), [])
  assert.deepEqual(plain(law.mergeOrder(3)), [0, 1, 2])
  assert.deepEqual(plain(law.mergeOrder(1)), [])
  assert.equal(law.finalLane(4), 3)
  assert.equal(law.finalLane(1), null)
  assert.equal(law.successor({ laneCount: 3, laneIndex: 2, closed: [] }), 0)
  assert.equal(law.successor({ laneCount: 3, laneIndex: 0, closed: [1] }), 2)
  assert.equal(law.successor({ laneCount: 3, laneIndex: 0, closed: [1, 2] }), 0)
  assert.equal(law.successor({ laneCount: 3, laneIndex: 0, closed: [0, 1, 2] }), null)
  assert.equal(law.successor({ laneCount: 3, laneIndex: 3, closed: [] }), null)
})

test('SPEC[fission-group-6] Fission consumes only settled turns; an external abort fails the group', () => {
  const s = (stage, observation) => law.settle({ stage, observation }).decision
  for (const o of ['OngoingExecution', 'NeedsContinuation', 'ProviderFailed', 'DegenerationInterrupted']) {
    assert.equal(s('lane', o), 'yield'); assert.equal(s('takeover', o), 'yield')
  }
  assert.equal(s('lane', 'ExternalAbort'), 'fail')
  assert.equal(s('takeover', 'ExternalAbort'), 'fail')
  assert.equal(s('lane', 'Completed'), 'materialize')
  assert.equal(s('takeover', 'Completed'), 'complete')
  assert.throws(() => law.settle({ stage: 'owner', observation: 'Completed' }))
})
