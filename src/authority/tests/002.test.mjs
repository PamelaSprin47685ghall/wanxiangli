import test from 'node:test'
import assert from 'node:assert/strict'
import { Authority } from 'wanxiangli/authority'

const authority = new Authority()
const H = { kind: 'AuthorityRoot', root: 'HumanRoot' }, A = { kind: 'AuthorityRoot', root: 'AgentOwnerRoot' }
const C = { kind: 'Continuation', continuation: 'JoinGuard' }
const origins = [H, A, C, { kind: 'HostInternal' }, { kind: 'UnknownOrigin' }]

// Independent oracle, written from interaction-authority [005][007][009] and dispatch-protocol-006, not from the F# source.
const oracle = (i) => {
  if (i.invalidCarrier) return { kind: 'reject', reason: 'malformed-carrier', carrier: i.invalidCarrier }
  const managed = !!(i.promptKey || i.explicitAgent)
  const ae = i.acceptedEvidence
  if (ae && i.sessionId && i.physicalId && !i.promptKey && ae.sessionId === i.sessionId && ae.physicalId === i.physicalId
      && ae.origin.kind === 'AuthorityRoot' && ae.origin.root === 'HumanRoot' && !i.hostInternal)
    return i.explicitAgent && i.explicitAgent !== ae.selectedAgent
      ? { kind: 'reject', reason: 'accepted-participant-conflict' } : { kind: 'accepted-root-replay' }
  if (!i.sessionId) return i.hostInternal ? { kind: 'host-internal' } : managed ? { kind: 'reject', reason: 'missing-session' } : { kind: 'unmanaged' }
  if (!i.authority) return i.hostInternal ? { kind: 'host-internal' } : managed ? { kind: 'reject', reason: 'authority-unavailable' } : { kind: 'unmanaged' }
  const active = i.authority.active ?? null
  if (!i.physicalId) return (managed || active) ? { kind: 'reject', reason: 'missing-physical' } : i.hostInternal ? { kind: 'host-internal' } : { kind: 'unmanaged' }
  if (i.acceptedContinuation) return { kind: 'already-accepted', origin: { kind: 'Continuation', continuation: i.acceptedContinuation } }
  if (i.landedOrigin) return { kind: 'already-accepted', origin: i.landedOrigin }
  const c = i.pendingClaim
  if (c) {
    if (c.sessionId !== i.sessionId) return { kind: 'reject', reason: 'claim-session-mismatch' }
    const admissible = c.origin.kind === 'Continuation' || (c.origin.kind === 'AuthorityRoot' && c.origin.root === 'AgentOwnerRoot')
    if (!admissible) return { kind: 'reject', reason: 'claim-origin-not-admissible' }
    if (i.explicitAgent && i.explicitAgent !== c.selectedAgent) return { kind: 'reject', reason: 'invalid-explicit-agent' }
    return { kind: 'pending-prompt' }
  }
  if (i.hostInternal) return { kind: 'host-internal' }
  if (i.promptKey) return { kind: 'reject', reason: active?.kind === 'AgentOwnerRoot' ? 'agent-owner-root-prompt-not-claimed' : 'prompt-key-not-claimed' }
  if (i.explicitAgent) {
    if (!i.explicitRootAgent) return { kind: 'reject', reason: 'invalid-explicit-agent' }
    if (active) return active.selectedAgent === i.explicitRootAgent ? { kind: 'active-human-continuation' } : { kind: 'reject', reason: 'unknown-origin-while-active' }
    return { kind: 'external-root' }
  }
  return active ? { kind: 'active-human-continuation' } : { kind: 'unmanaged' }
}

function* universe() {
  const authorities = [null, { active: null }, { active: { kind: 'HumanRoot', selectedAgent: 'manager' } }, { active: { kind: 'AgentOwnerRoot', selectedAgent: 'engineer' } }]
  const agents = [[null, null], ['manager', 'manager'], ['engineer', 'engineer'], ['bogus', null]]
  const claims = [null, ...origins.map((origin) => ({ sessionId: 's1', origin, selectedAgent: 'engineer' })), { sessionId: 's2', origin: C, selectedAgent: 'engineer' }]
  const accepted = [null, { sessionId: 's1', physicalId: 'p1', origin: H, selectedAgent: 'manager' }, { sessionId: 's1', physicalId: 'p1', origin: A, selectedAgent: 'engineer' }, { sessionId: 's1', physicalId: 'p9', origin: H, selectedAgent: 'manager' }]
  for (const invalidCarrier of [null, 'agent'])
  for (const sessionId of [null, 's1'])
  for (const physicalId of [null, 'p1'])
  for (const promptKey of [null, 'k1'])
  for (const [explicitAgent, explicitRootAgent] of agents)
  for (const hostInternal of [false, true])
  for (const auth of authorities)
  for (const acceptedContinuation of [null, 'HumanMessage'])
  for (const landedOrigin of [null, A])
  for (const pendingClaim of claims)
  for (const acceptedEvidence of accepted)
    yield { invalidCarrier, sessionId, physicalId, promptKey, explicitAgent, explicitRootAgent, hostInternal, authority: auth, acceptedContinuation, landedOrigin, pendingClaim, acceptedEvidence }
}

test('SPEC[authority-005] admission follows the fixed entrance order on every combination', () => {
  let n = 0; const kinds = new Set()
  for (const input of universe()) {
    const got = authority.admit(input)
    assert.deepEqual(got, oracle(input), JSON.stringify(input))
    kinds.add(got.kind === 'reject' ? `reject:${got.reason}` : got.kind); n++
  }
  // Every outcome of the law is reached at least once, so the oracle comparison is not vacuous.
  assert.equal(kinds.size, 18, [...kinds].join(','))
  assert.equal(n, 57344)
})

test('SPEC[authority-005] a new HumanRoot is granted only on resolved explicit participant evidence with no active run', () => {
  for (const input of universe()) {
    if (authority.admit(input).kind !== 'external-root') continue
    assert.ok(input.explicitRootAgent && input.authority && !input.authority.active && !input.promptKey && !input.pendingClaim, JSON.stringify(input))
  }
  // A claim carrying HumanRoot is never admissible: a claim cannot mint a HumanRoot.
  const got = authority.admit({ sessionId: 's1', physicalId: 'p1', hostInternal: false, authority: { active: null }, pendingClaim: { sessionId: 's1', origin: H, selectedAgent: 'manager' } })
  assert.deepEqual(got, { kind: 'reject', reason: 'claim-origin-not-admissible' })
})

test('SPEC[authority-005] malformed admission input throws instead of guessing', () => {
  const ok = { sessionId: 's1', physicalId: 'p1', hostInternal: false, authority: { active: null } }
  for (const bad of [null, 'x', { ...ok, hostInternal: 'no' }, { ...ok, sessionId: 7 }, { ...ok, invalidCarrier: 'Other' },
    { ...ok, authority: { active: { kind: 'Root', selectedAgent: 'm' } } }, { ...ok, pendingClaim: { sessionId: 's1', origin: { kind: 'X' }, selectedAgent: 'e' } },
    { ...ok, acceptedEvidence: { sessionId: 's1', physicalId: 'p1', origin: H } }, { ...ok, authority: 3 }])
    assert.throws(() => authority.admit(bad), /wanxiangli\/authority: malformed/, JSON.stringify(bad))
})
