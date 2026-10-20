import test from 'node:test'
import assert from 'node:assert/strict'

import { CapacityReconciliation } from 'wanxiangli/capacity'

const owner = (fields = {}) => ({ sessionId: 's1', physicalUserMessageId: 'p1', role: 'engineer', participant: 'alice', ...fields })
const other = owner({ sessionId: 's2', physicalUserMessageId: 'p2', role: null, participant: null })

// 两个 credit：一个 InFlight 归 s1，一个 Idle 归 s2；s1 有执行且有托管；s2 在等。
const consistent = (patch = {}) => ({
  ledgerEntries: [{ credit: 1 }, { credit: 2 }],
  tokens: [
    { credit: 1, state: 'InFlight', owner: owner() },
    { credit: 2, state: 'Idle', owner: other },
  ],
  custodies: [{ credit: 1, owner: owner() }],
  executions: [owner()],
  waiters: [{ owner: other }],
  owners: [owner(), other],
  idleCount: 1,
  inFlightCount: 1,
  retiringCount: 0,
  activeCount: 1,
  counters: { duplicate: 0, stale: 0, conflict: 0 },
  ...patch,
})

const decide = (evidence) => new CapacityReconciliation().decide(evidence)
const failures = (evidence) => {
  const result = decide(evidence)
  return result.decision === 'NoOp' ? [] : [...result.failures]
}

test('SPEC[capacity-1] a consistent snapshot reconciles to NoOp and the result is frozen', () => {
  const result = decide(consistent())
  assert.deepEqual(result, { decision: 'NoOp' })
  assert.ok(Object.isFrozen(result))
  assert.deepEqual(decide(consistent({ ledgerEntries: [], tokens: [], custodies: [], executions: [], waiters: [], owners: [], idleCount: 0, inFlightCount: 0, activeCount: 0 })), { decision: 'NoOp' })
})

test('SPEC[capacity-1] each failure class fires exactly its own name', () => {
  const cases = [
    ['ActiveOutsideLedgerBounds', { activeCount: 2 }],
    ['ActiveOutsideLedgerBounds', { activeCount: -1 }],
    ['TokenStateCountMismatch', { idleCount: 0 }],
    ['MapLedgerDivergence', { ledgerEntries: [{ credit: 1 }, { credit: 3 }] }],
    ['UntraceableTokenOwner', { tokens: [{ credit: 1, state: 'InFlight', owner: owner() }, { credit: 2, state: 'Idle', owner: owner({ participant: 'bob' }) }], waiters: [] }],
    ['UntraceableWaiterOwner', { waiters: [{ owner: owner({ physicalUserMessageId: 'p9' }) }] }],
    ['UntraceableExecutionCustody', { custodies: [] }],
    ['CounterRegression', { counters: { duplicate: 0, stale: -1, conflict: 0 } }],
  ]
  for (const [name, patch] of cases) assert.deepEqual(failures(consistent(patch)), [name], JSON.stringify(patch))
})

test('SPEC[capacity-1] null role and empty role are different owners', () => {
  assert.deepEqual(failures(consistent({ waiters: [{ owner: { ...other, role: '' } }] })), ['UntraceableWaiterOwner'])
})

test('SPEC[capacity-1] an unknown token state counts in no class', () => {
  const tokens = [{ credit: 1, state: 'InFlight', owner: owner() }, { credit: 2, state: 'idle', owner: other }]
  assert.deepEqual(failures(consistent({ tokens, idleCount: 0 })), ['TokenStateCountMismatch'])
})

test('SPEC[capacity-1] coexisting failures are all reported in the fixed order', () => {
  const result = decide(consistent({ activeCount: 5, idleCount: 9, ledgerEntries: [{ credit: 7 }], waiters: [{ owner: owner({ sessionId: 'x' }) }], custodies: [], counters: { duplicate: -1, stale: 0, conflict: 0 } }))
  assert.equal(result.decision, 'FailClosed')
  assert.ok(Object.isFrozen(result.failures))
  assert.deepEqual([...result.failures], ['ActiveOutsideLedgerBounds', 'TokenStateCountMismatch', 'MapLedgerDivergence', 'UntraceableWaiterOwner', 'UntraceableExecutionCustody', 'CounterRegression'])
})

test('SPEC[capacity-2] malformed snapshots throw instead of reconciling to NoOp', () => {
  for (const patch of [{ tokens: null }, { owners: {} }, { idleCount: 1.5 }, { activeCount: '1' }, { counters: null }, { counters: { duplicate: 0, stale: 0 } }, { executions: [{ sessionId: 's1' }] }, { owners: [owner({ role: 7 })] }]) {
    assert.throws(() => decide(consistent(patch)), /capacity reconciliation/, JSON.stringify(patch))
  }
  assert.throws(() => decide(null), /capacity reconciliation/)
})
