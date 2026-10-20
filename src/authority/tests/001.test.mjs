import test from 'node:test'
import assert from 'node:assert/strict'
import { Authority } from 'wanxiangli/authority'

const authority = new Authority()
const root = (over = {}) => ({ sessionId: 's1', logicalRunId: 'run-1', rootId: 'msg-1', kind: 'HumanRoot', seed: '{"a":1}', ...over })

test('SPEC[authority-001] origin precedence never invents a HumanRoot and fails closed', () => {
  const claims = [null, { kind: 'Continuation', continuation: 'JoinGuard' }, { kind: 'AuthorityRoot', root: 'AgentOwnerRoot' },
    { kind: 'HostInternal' }, { kind: 'UnknownOrigin' }]
  for (const acceptedContinuation of [null, 'HumanMessage'])
    for (const claimOrigin of claims)
      for (const hasPromptKey of [false, true])
        for (const hostCompaction of [false, true])
          for (const activeKind of [null, 'HumanRoot', 'AgentOwnerRoot']) {
            const got = authority.resolveOrigin({ acceptedContinuation, claimOrigin, hasPromptKey, hostCompaction, activeKind })
            let want
            if (acceptedContinuation) want = { kind: 'Continuation', continuation: acceptedContinuation }
            else if (claimOrigin) want = claimOrigin
            else if (hostCompaction) want = { kind: 'HostInternal' }
            else if (hasPromptKey && activeKind === 'AgentOwnerRoot') want = { kind: 'AuthorityRoot', root: 'AgentOwnerRoot' }
            else want = { kind: 'UnknownOrigin' }
            assert.deepEqual(got, want, JSON.stringify({ acceptedContinuation, claimOrigin, hasPromptKey, hostCompaction, activeKind }))
            if (!claimOrigin) assert.notDeepEqual(got, { kind: 'AuthorityRoot', root: 'HumanRoot' })
          }
})

test('SPEC[authority-001] an active HumanRoot does not lift an unclaimed message into a root', () => {
  assert.deepEqual(authority.resolveOrigin({ hasPromptKey: true, hostCompaction: false, activeKind: 'HumanRoot' }), { kind: 'UnknownOrigin' })
  assert.deepEqual(authority.resolveOrigin({ hasPromptKey: false, hostCompaction: false, activeKind: 'AgentOwnerRoot' }), { kind: 'UnknownOrigin' })
})

test('SPEC[authority-002] one active root: admit, exact replay, or conflict', () => {
  assert.equal(authority.register(null, root()), 'admit')
  assert.equal(authority.register(root(), root()), 'replay')
  assert.equal(authority.register(root(), root({ logicalRunId: 'run-other' })), 'replay', 'durable replay of the same physical root')
  for (const over of [{ sessionId: 's2' }, { rootId: 'msg-2' }, { kind: 'AgentOwnerRoot' }, { seed: '{"a":2}' }])
    assert.equal(authority.register(root(), root(over)), 'conflict', JSON.stringify(over))
})

test('SPEC[authority-003] closure names the exact run; stale closure never hits the new run', () => {
  const active = root(), last = root()
  assert.equal(authority.close(active, last, 'run-1', 'msg-1'), 'close')
  assert.equal(authority.close(active, last, 'run-0', 'msg-0'), 'mismatch')
  assert.equal(authority.close(active, last, 'run-1', 'msg-other'), 'mismatch')
  assert.equal(authority.close(null, last, 'run-1', 'msg-1'), 'already-closed')
  assert.equal(authority.close(null, last, 'run-0', 'msg-1'), 'no-authority')
  assert.equal(authority.close(null, null, 'run-1', 'msg-1'), 'no-authority')
})

test('SPEC[authority-003] child-work closure needs a non-Manager AgentOwnerRoot', () => {
  const child = root({ kind: 'AgentOwnerRoot' })
  assert.equal(authority.closeChildWork(child, false, child, 'run-1', 'msg-1'), 'close')
  assert.equal(authority.closeChildWork(child, true, child, 'run-1', 'msg-1'), 'not-child-work')
  assert.equal(authority.closeChildWork(root(), false, root(), 'run-1', 'msg-1'), 'not-child-work')
  assert.equal(authority.closeChildWork(child, false, child, 'run-0', 'msg-1'), 'mismatch')
  assert.equal(authority.closeChildWork(null, false, child, 'run-1', 'msg-1'), 'already-closed')
  assert.equal(authority.closeChildWork(null, true, null, 'run-1', 'msg-1'), 'no-authority')
})

test('SPEC[authority-004] malformed input throws instead of guessing', () => {
  assert.throws(() => authority.register(null, root({ kind: 'human' })), /malformed/)
  assert.throws(() => authority.register(null, root({ seed: 7 })), /malformed/)
  assert.throws(() => authority.register(null, { ...root(), sessionId: undefined }), /malformed/)
  assert.throws(() => authority.register('x', root()), /malformed/)
  assert.throws(() => authority.close(null, null, null, 'msg-1'), /malformed/)
  assert.throws(() => authority.closeChildWork(null, 'no', null, 'run-1', 'msg-1'), /malformed/)
  assert.throws(() => authority.resolveOrigin({ hasPromptKey: 1, hostCompaction: false }), /malformed/)
  assert.throws(() => authority.resolveOrigin({ hasPromptKey: true, hostCompaction: false, claimOrigin: { kind: 'Human' } }), /malformed/)
  assert.throws(() => authority.resolveOrigin(null), /malformed/)
})
