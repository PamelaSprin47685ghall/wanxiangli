import test from 'node:test'
import assert from 'node:assert/strict'
import { PrefixHistory } from 'wanxiangli/prefix'
const scope = (from, callId) => ({ previousEpoch: from, nextEpoch: from + 1n, evidence: { kind: 'scope', callId } })
const accepted = result => { assert.equal(result.ok, true, JSON.stringify(result, (_, v) => typeof v === 'bigint' ? String(v) : v)); return result.value }

test('history owns immutable generations and absorbs replay before retiring an archive twice', () => {
  const empty = new PrefixHistory()
  const first = accepted(empty.advanceScope(scope(0n, 'reset'), 'ref', 'digest'))
  const asked = accepted(first.recordScopeQuestion(1n, 'ask', 'questions'))
  assert.equal(empty.epoch(), 0n)
  assert.equal(first.scopeQuestion('ask'), null)
  assert.equal(asked.recordScopeQuestion(1n, 'ask', 'questions').value, asked)
  assert.equal(asked.recordScopeQuestion(1n, 'ask', 'different').error, 'scope question receipt conflict')
  const repeated = asked.advanceScope(scope(0n, 'reset'), 'other', 'other')
  assert.equal(repeated.ok, false)
  assert.equal(repeated.error, 'AlreadyReanchored')
  assert.equal(repeated.absorbed, true)
  assert.equal(asked.scopeQuestion('ask'), 'questions')
  assert.equal(asked.lastScopeArchive().reference, 'ref')
  assert.throws(() => { asked.lastScopeArchive().reference = 'mutated' }, TypeError)
  assert.throws(() => asked.reanchored('scope').push('mutated'), TypeError)
})

test('ordinary advances retain archive and questions; scope with either missing archive field clears them', () => {
  const first = accepted(new PrefixHistory().advanceScope(scope(0n, 'reset'), 'ref', 'digest'))
  const asked = accepted(first.recordScopeQuestion(1n, 'ask', 'questions'))
  let next = accepted(asked.advance({previousEpoch:1n,nextEpoch:2n,evidence:{kind:'compaction',run:'run'}}))
  next = accepted(next.advance({previousEpoch:2n,nextEpoch:3n,evidence:{kind:'tenure',incumbencyId:'tenure'}}))
  assert.equal(next.lastScopeArchive().targetEpoch, 1n)
  assert.equal(next.scopeQuestion('ask'), 'questions')
  assert.equal(next.recordScopeQuestion(3n, 'new', 'q').error, 'stale scope epoch or missing prior archive')
  for (const [reference,digest] of [[null,'digest'],['ref',null],[null,null]]) {
    const cleared = accepted(next.advanceScope(scope(3n, 'next-reset'), reference, digest))
    assert.equal(cleared.epoch(), 4n)
    assert.equal(cleared.lastScopeArchive(), null)
    assert.equal(cleared.scopeQuestion('ask'), null)
    assert.equal(cleared.scopeCount(), 2)
  }
})

test('history keeps exact bigint and the existing refusal order and latest compaction proposal', () => {
  const base = 9007199254740993n
  const history = new PrefixHistory({epoch:base,compactionRuns:['seen'],tenures:[]})
  assert.equal(history.epoch(), base)
  const proposed = history.proposeCompaction(['seen','older','latest'])
  assert.equal(BigInt(proposed.previousEpoch), base)
  assert.equal(proposed.evidence.run, 'latest')
  assert.equal(history.epoch(), base)
  assert.equal(history.advance({previousEpoch:0n,nextEpoch:99n,evidence:{kind:'compaction',run:'seen'}}).error,'AlreadyReanchored')
  assert.equal(history.advance({previousEpoch:0n,nextEpoch:99n,evidence:{kind:'scope',callId:'reset'}}).error,'StaleEpoch')
  assert.equal(history.advance({previousEpoch:base,nextEpoch:base+2n,evidence:{kind:'scope',callId:'reset'}}).error,'NonSequentialEpoch')
  const next = accepted(history.advanceScope(scope(base, 'reset'), 'ref','d'))
  assert.equal(next.lastScopeArchive().targetEpoch, base + 1n)
  assert.equal(next.epoch(), base + 1n)
})
