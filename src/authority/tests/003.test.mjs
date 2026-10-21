import test from 'node:test'
import assert from 'node:assert/strict'
import { Authority } from 'wanxiangli/authority'

// SPEC[authority-6..8] interaction-authority-018 (CUT-09-b). The oracle below is written from WHAT [018], not from the F# source.
const a = new Authority()
const KINDS = ['HumanRootManagerLife', 'HumanRootManagedRun', 'AgentOwnerChildWork', 'AgentOwnerAttachedWork', 'AgentOwnerInternalLeaf']
const rootOf = (k) => (k.startsWith('HumanRoot') ? 'HumanRoot' : 'AgentOwnerRoot')
const witnessFor = {
  HumanRootManagerLife: (c) => ({ kind: 'LifeCompleted', lifeId: c.lifeId, factId: 'f1' }),
  HumanRootManagedRun: (c) => ({ kind: 'ManagedLogicalRunTerminal', logicalRunId: c.logicalRunId, factId: 'f1' }),
  AgentOwnerChildWork: (c) => ({ kind: 'ChildLogicalRunTerminal', ownerLogicalRunId: c.ownerLogicalRunId, childLogicalRunId: c.logicalRunId, factId: 'f1' }),
  AgentOwnerAttachedWork: (c) => ({ kind: 'AttachedLogicalRunTerminal', ownerLogicalRunId: c.ownerLogicalRunId, childLogicalRunId: c.logicalRunId, attachmentKind: 'Blogger', associationGeneration: '3', factId: 'f1' }),
  AgentOwnerInternalLeaf: (c) => ({ kind: 'InternalLeafTerminal', ownerLogicalRunId: c.ownerLogicalRunId, leafLogicalRunId: c.logicalRunId, decisionOrTransactionId: 'tx9', factId: 'f1' }),
}
const closingFor = (kind) => ({
  kind, sessionId: 'ses_a', logicalRunId: 'run_a', rootId: 'msg_a',
  ownerLogicalRunId: rootOf(kind) === 'AgentOwnerRoot' ? 'owner_run' : null,
  lifeId: kind === 'HumanRootManagerLife' ? 'ses_a' : null,
})

test('SPEC[authority-6] every accepted root falls into exactly one of the five closure kinds, or is unclassifiable', () => {
  assert.equal(a.expectedClosureKind('HumanRoot', true, null), 'HumanRootManagerLife')
  assert.equal(a.expectedClosureKind('HumanRoot', false, null), 'HumanRootManagedRun')
  for (const isManager of [true, false]) {
    assert.equal(a.expectedClosureKind('AgentOwnerRoot', isManager, 'child'), 'AgentOwnerChildWork')
    assert.equal(a.expectedClosureKind('AgentOwnerRoot', isManager, 'attached'), 'AgentOwnerAttachedWork')
    assert.equal(a.expectedClosureKind('AgentOwnerRoot', isManager, 'internal-leaf'), 'AgentOwnerInternalLeaf', 'InternalLeaf regardless of ownership')
    assert.equal(a.expectedClosureKind('AgentOwnerRoot', isManager, null), null, 'an AgentOwnerRoot without a lifecycle cannot be classified')
    for (const life of ['child', 'attached', 'internal-leaf'])
      assert.equal(a.expectedClosureKind('HumanRoot', isManager, life), null, 'a HumanRoot never carries an AgentOwner lifecycle')
  }
  assert.throws(() => a.expectedClosureKind('HumanRoot', true, 'leaf'))
  assert.throws(() => a.expectedClosureKind('Human', true, null))
})

test('SPEC[authority-7] witness encoding is canonical and round-trips; anything else decodes to null', () => {
  for (const kind of KINDS) {
    const w = witnessFor[kind](closingFor(kind))
    const text = a.encodeClosureWitness(w)
    assert.equal(JSON.parse(text)[0], w.kind)
    assert.deepEqual({ ...a.decodeClosureWitness(text) }, w)
    assert.equal(a.encodeClosureWitness(a.decodeClosureWitness(text)), text)
  }
  for (const bad of ['', 'ret_1', '[]', '["LifeCompleted","x"]', '["LifeCompleted","x","y","z"]', '["Nope","x","y"]', '[1,2,3]', '{"kind":"LifeCompleted"}', '["LifeCompleted","x",'])
    assert.equal(a.decodeClosureWitness(bad), null, bad)
})

test('SPEC[authority-8] a closure is admitted only when kind, owner, run and life match exactly', () => {
  for (const kind of KINDS) {
    const closing = closingFor(kind)
    const good = a.encodeClosureWitness(witnessFor[kind](closing))
    const ok = a.admitClosure(closing, rootOf(kind), good)
    assert.equal(ok.ok, true, kind)
    assert.equal(ok.legacy, false)
    // wrong recorded root kind
    assert.deepEqual({ ...a.admitClosure(closing, rootOf(kind) === 'HumanRoot' ? 'AgentOwnerRoot' : 'HumanRoot', good) }, { ok: false, reason: 'root-kind-mismatch' })
    // every other kind's witness is refused
    for (const other of KINDS.filter((k) => k !== kind)) {
      const foreign = a.encodeClosureWitness(witnessFor[other]({ ...closingFor(other), logicalRunId: closing.logicalRunId }))
      assert.deepEqual({ ...a.admitClosure(closing, rootOf(kind), foreign) }, { ok: false, reason: 'witness-kind-mismatch' }, `${kind} <- ${other}`)
    }
    // each identity field changed, or emptied, is refused
    const w = witnessFor[kind](closing)
    for (const field of Object.keys(w).filter((f) => f !== 'kind')) {
      for (const value of [w[field] + 'x', '']) {
        const r = a.admitClosure(closing, rootOf(kind), a.encodeClosureWitness({ ...w, [field]: value }))
        const identity = !['factId', 'attachmentKind', 'associationGeneration', 'decisionOrTransactionId'].includes(field)
        if (identity || value === '') assert.deepEqual({ ...r }, { ok: false, reason: 'witness-identity-mismatch' }, `${kind}.${field}=${value}`)
        else assert.equal(r.ok, true, `${kind}.${field} is not an identity field`)
      }
    }
  }
})

test('SPEC[authority-8] a closing root missing its owner run or life is refused, never guessed', () => {
  const life = closingFor('HumanRootManagerLife')
  const lifeWitness = a.encodeClosureWitness(witnessFor.HumanRootManagerLife(life))
  assert.deepEqual({ ...a.admitClosure({ ...life, lifeId: null }, 'HumanRoot', lifeWitness) }, { ok: false, reason: 'closing-identity-missing' })
  const child = closingFor('AgentOwnerChildWork')
  const childWitness = a.encodeClosureWitness(witnessFor.AgentOwnerChildWork(child))
  assert.deepEqual({ ...a.admitClosure({ ...child, ownerLogicalRunId: null }, 'AgentOwnerRoot', childWitness) }, { ok: false, reason: 'closing-identity-missing' })
})

test('SPEC[authority-8] a pre-CUT-09-b bare retirement id is read only as a Manager life witness', () => {
  const life = closingFor('HumanRootManagerLife')
  const legacy = a.admitClosure(life, 'HumanRoot', 'ret_123')
  assert.equal(legacy.ok, true)
  assert.equal(legacy.legacy, true)
  assert.deepEqual({ ...legacy.witness }, { kind: 'LifeCompleted', lifeId: 'ses_a', factId: 'ret_123' })
  for (const kind of KINDS.filter((k) => k !== 'HumanRootManagerLife'))
    assert.deepEqual({ ...a.admitClosure(closingFor(kind), rootOf(kind), 'ret_123') }, { ok: false, reason: 'malformed-witness' }, kind)
  for (const bad of ['', '   ', '["LifeCompleted","ses_a"]'])
    assert.equal(a.admitClosure(life, 'HumanRoot', bad).ok, false, `"${bad}"`)
})
