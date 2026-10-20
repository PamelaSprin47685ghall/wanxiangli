import test from 'node:test'
import assert from 'node:assert/strict'

import { AttachmentLeaseLaw } from 'wanxiangli/attachment-lease'

const law = new AttachmentLeaseLaw()
const plain = (v) => JSON.parse(JSON.stringify(v))
const resolve = (over) => plain(law.resolve({ restoreHint: null, agent: 'a', title: 't', children: [], ...over }))
const child = (sessionId, agent = 'a', title = 't') => ({ sessionId, agent, title })

test('SPEC[attachment-lease-1] no durable association creates, never adopts a look-alike child', () => {
  assert.deepEqual(resolve({}), { verdict: 'create', origin: 'Created', closeReplacedBeforeLink: false })
  assert.deepEqual(resolve({ children: [child('x')] }), { verdict: 'create', origin: 'Created', closeReplacedBeforeLink: false })
})

test('SPEC[attachment-lease-1] the hinted child is reused only on an exact agent and title match', () => {
  assert.deepEqual(resolve({ restoreHint: 'x', children: [child('y'), child('x')] }), { verdict: 'reuse', child: 'x' })
  assert.deepEqual(resolve({ restoreHint: 'x', children: [child('x', 'b')] }), { verdict: 'reject', rejection: 'Conflicting', child: 'x' })
  assert.deepEqual(resolve({ restoreHint: 'x', children: [child('x', 'a', 'u')] }), { verdict: 'reject', rejection: 'Conflicting', child: 'x' })
  assert.deepEqual(resolve({ restoreHint: 'x', children: [{ sessionId: 'x' }] }), { verdict: 'reject', rejection: 'Conflicting', child: 'x' })
})

test('SPEC[attachment-lease-1] counterexample: a vanished hinted child is a replacement that closes first; duplicates are ambiguity', () => {
  assert.deepEqual(resolve({ restoreHint: 'x', children: [child('y')] }), { verdict: 'create', origin: 'Replacement', closeReplacedBeforeLink: true })
  assert.deepEqual(resolve({ restoreHint: 'x', children: [child('x'), child('x')] }), { verdict: 'reject', rejection: 'Ambiguous', child: 'x' })
})

test('SPEC[attachment-lease-1] only a fresh child is aborted when its association fails', () => {
  assert.equal(law.abortOnFailure('Created'), true)
  assert.equal(law.abortOnFailure('Replacement'), true)
  assert.equal(law.abortOnFailure('Reused'), false)
  assert.throws(() => law.abortOnFailure('Other'), /origin/)
})

test('SPEC[attachment-lease-1] malformed input is refused and verdicts are frozen', () => {
  assert.throws(() => law.resolve(null), /input/)
  assert.throws(() => resolve({ agent: 1 }), /agent/)
  assert.throws(() => resolve({ children: {} }), /children/)
  assert.throws(() => resolve({ children: [{ agent: 'a' }] }), /children\[0\]\.sessionId/)
  assert.ok(Object.isFrozen(law.resolve({ restoreHint: null, agent: 'a', title: 't', children: [] })))
})
