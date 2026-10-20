import test from 'node:test'
import assert from 'node:assert/strict'

import { Dispatch } from 'wanxiangli/dispatch'

const law = new Dispatch()
const ABSENT = '\u0000absent'
const SEP = '\u001f'

test('SPEC[dispatch-1] PromptKey material is deterministic, moves with every element and keeps absent apart from blank', () => {
  assert.equal(law.contractVersion, 1)
  const base = { sessionId: 's', logicalRunId: 'r', authorityRoot: 'a', origin: 'Continuation:Guard', payloadDigest: 'd', claimSequence: 1 }
  assert.equal(law.promptKeyMaterial(base), ['s', 'r', 'a', 'Continuation:Guard', 'd', '1'].join(SEP))
  assert.equal(law.promptKeyMaterial({ ...base }), law.promptKeyMaterial(base))
  const seen = new Set([law.promptKeyMaterial(base)])
  for (const [k, v] of [['sessionId', 's2'], ['logicalRunId', 'r2'], ['authorityRoot', 'a2'], ['origin', 'HostInternal'], ['payloadDigest', 'd2'], ['claimSequence', 2], ['logicalRunId', null], ['authorityRoot', null], ['logicalRunId', ''], ['authorityRoot', '']]) {
    const m = law.promptKeyMaterial({ ...base, [k]: v })
    assert.ok(!seen.has(m), `${k}=${JSON.stringify(v)} must move the key`)
    seen.add(m)
  }
  assert.equal(law.promptKeyMaterial({ ...base, logicalRunId: null, authorityRoot: undefined }), ['s', ABSENT, ABSENT, 'Continuation:Guard', 'd', '1'].join(SEP))
  assert.equal(law.claimScope({ sessionId: 's', origin: 'o', payloadDigest: 'd' }), ['s', ABSENT, 'o', 'd'].join(SEP))
  assert.equal(law.claimScope({ sessionId: 's', logicalRunId: 'r', origin: 'o', payloadDigest: 'd' }), ['s', 'r', 'o', 'd'].join(SEP))
  for (const bad of [0, -1, 1.5, '1', null, undefined, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => law.promptKeyMaterial({ ...base, claimSequence: bad }), /malformed claimSequence/)
  assert.throws(() => law.promptKeyMaterial({ ...base, agent: 'x', sessionId: 3 }), /malformed sessionId/)
  assert.throws(() => law.claimScope(null), /malformed/)
})

test('SPEC[dispatch-2] ClaimSequence starts at one and is consumed on every registration', () => {
  assert.equal(law.nextClaimSequence(null), 1)
  assert.equal(law.nextClaimSequence(undefined), 1)
  assert.equal(law.nextClaimSequence(0), 1)
  assert.equal(law.nextClaimSequence(1), 2)
  assert.equal(law.nextClaimSequence(41), 42)
  assert.equal(law.alreadyClaimed(null), false)
  assert.equal(law.alreadyClaimed(0), false)
  assert.equal(law.alreadyClaimed(1), true)
  for (const bad of [-1, 1.5, '2', {}]) assert.throws(() => law.nextClaimSequence(bad), /malformed consumed/)
})

// Independent oracle written from dispatch-protocol [002][003][006] and effect-accounting [004].
const oracle = (event, pending, continuation) => {
  if (!pending) return []
  if (event === 'Submit') return ['RecordReceipt']
  if (event === 'Accept') return ['DropPending', 'LandOccasion', 'LandExact', ...(continuation ? ['RecordContinuation'] : [])]
  return ['DropPending', 'ClearOccasion']
}

test('SPEC[dispatch-3] settlement edits follow the four-state lifecycle and never regress a landing', () => {
  for (const event of ['Submit', 'Accept', 'Abandon'])
    for (const pending of [true, false])
      for (const continuation of [true, false]) {
        const edits = law.settle({ event, pending, continuation })
        assert.deepEqual([...edits], oracle(event, pending, continuation), `${event}/${pending}/${continuation}`)
        assert.ok(Object.isFrozen(edits))
      }
  assert.throws(() => law.settle({ event: 'Retry', pending: true, continuation: false }), /malformed event/)
  assert.throws(() => law.settle({ event: 'Accept', pending: 1, continuation: false }), /malformed pending/)

  // A tiny projection model driven only by the edits: two acts with the same payload
  // land on two physical messages and both exact landings survive a later abandon.
  const proj = { pending: new Map(), occasion: new Map(), exact: new Map(), receipts: new Set() }
  const apply = (event, key, physical) => {
    const claim = proj.pending.get(key)
    for (const edit of law.settle({ event, pending: !!claim, continuation: claim?.continuation ?? false })) {
      if (edit === 'RecordReceipt') proj.receipts.add(key)
      if (edit === 'DropPending') proj.pending.delete(key)
      if (edit === 'LandOccasion') proj.occasion.set(claim.payload, key)
      if (edit === 'LandExact') proj.exact.set(physical, key)
      if (edit === 'ClearOccasion') proj.occasion.delete(claim.payload)
    }
  }
  proj.pending.set('k1', { payload: 'p', continuation: true })
  apply('Submit', 'k1')
  assert.ok(proj.pending.has('k1'), 'a transport receipt keeps the claim pending')
  apply('Accept', 'k1', 'm1')
  proj.pending.set('k2', { payload: 'p', continuation: true })
  apply('Accept', 'k2', 'm2')
  assert.equal(proj.occasion.get('p'), 'k2')
  proj.pending.set('k3', { payload: 'p', continuation: true })
  apply('Abandon', 'k3')
  apply('Accept', 'k1', 'm9')
  apply('Abandon', 'k1')
  assert.deepEqual([...proj.exact], [['m1', 'k1'], ['m2', 'k2']])
  assert.equal(proj.occasion.has('p'), false)
})

test('SPEC[dispatch-4] an exact occasion stays admitted while pending or landed with the same origin', () => {
  const o = 'Continuation:GateNudge'
  assert.equal(law.occasionAdmitted({ pendingSameOccasion: true, landedOrigin: null, origin: o }), true)
  assert.equal(law.occasionAdmitted({ pendingSameOccasion: false, landedOrigin: o, origin: o }), true)
  assert.equal(law.occasionAdmitted({ pendingSameOccasion: false, landedOrigin: 'Continuation:Other', origin: o }), false)
  assert.equal(law.occasionAdmitted({ pendingSameOccasion: false, origin: o }), false)
  assert.equal(law.occasionAdmitted({ pendingSameOccasion: true, landedOrigin: 'x', origin: o }), true)
  assert.throws(() => law.occasionAdmitted({ pendingSameOccasion: 'yes', origin: o }), /malformed/)
})

test('SPEC[dispatch-5] recovery proves only from a user message with the exact key inside the tail window', () => {
  assert.equal(law.recoveryTailWindow, 50)
  const filler = (n) => Array.from({ length: n }, (_, i) => ({ role: 'user', promptKey: null, id: `f${i}` }))
  const hit = { role: 'user', promptKey: 'K', id: 'phys' }
  assert.deepEqual({ ...law.recover({ promptKey: 'K', hasReceipt: false, messages: [...filler(3), hit] }) }, { kind: 'Proven', physicalUserMessageId: 'phys' })
  assert.deepEqual({ ...law.recover({ promptKey: 'K', hasReceipt: true, messages: [hit, ...filler(49)] }) }, { kind: 'Proven', physicalUserMessageId: 'phys' })
  assert.deepEqual({ ...law.recover({ promptKey: 'K', hasReceipt: true, messages: [hit, ...filler(50)] }) }, { kind: 'StillPending', hasReceipt: true })
  assert.deepEqual({ ...law.recover({ promptKey: 'K', hasReceipt: false, messages: [{ ...hit, role: 'assistant' }] }) }, { kind: 'StillPending', hasReceipt: false })
  assert.deepEqual({ ...law.recover({ promptKey: 'K', hasReceipt: false, messages: [{ ...hit, promptKey: 'K ' }, { ...hit, promptKey: 'k' }] }) }, { kind: 'StillPending', hasReceipt: false })
  assert.deepEqual({ ...law.recover({ promptKey: 'K', hasReceipt: false, messages: [{ ...hit, id: 'first' }, { ...hit, id: 'second' }] }) }, { kind: 'Proven', physicalUserMessageId: 'first' })
  assert.ok(Object.isFrozen(law.recover({ promptKey: 'K', hasReceipt: false, messages: [] })))
  assert.throws(() => law.recover({ promptKey: 'K', hasReceipt: false, messages: {} }), /malformed messages/)
  assert.throws(() => law.recover({ promptKey: 'K', hasReceipt: false, messages: [{ role: 'user', id: 3 }] }), /malformed message.id/)
})
