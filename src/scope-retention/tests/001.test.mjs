import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const require = createRequire(import.meta.url)

// Built artifact after `npm run build -- scope-retention`
const mod = await import(path.join(root, 'dist/scope-retention/Retention.js')).catch(async () => {
  // PackageExport may bundle under ScopeRetention / Retention depending on worker
  return import('wanxiangli/scope-retention')
})

const { scopeRetention, MaxRetentionBudget, isExemptTool } = mod

function fresh(session = 's1', epoch = '1') {
  scopeRetention.clear(session)
  scopeRetention.reset(session, epoch)
  return { session, epoch }
}

test('exempt tools recognized', () => {
  assert.equal(isExemptTool('negotiate'), true)
  assert.equal(isExemptTool('deliver'), true)
  assert.equal(isExemptTool('todowrite-for-manager'), false)
})

test('first non-exempt keepLast refused until resetScope', () => {
  const { session, epoch } = fresh()
  const r = scopeRetention.apply(session, epoch, 'bash', 'run1', 'c1', 'b1', { kind: 'keepLast' })
  assert.equal(r.ok, false)
  assert.match(r.reason, /not initialized|resetScope/)
})

test('resetScope opens budget; keepLast decrements; exhaust forces reset', () => {
  const { session, epoch } = fresh()
  const open = scopeRetention.apply(session, epoch, 'resetScope', 'run1', 'c1', 'b1', {
    kind: 'resetScope',
    newScopeGoal: 'land scope annotation',
    newScopeRetentionBudget: 2,
    oldScopeVerboseVerbatim: '',
  })
  assert.equal(open.ok, true)
  assert.equal(open.remaining, 2)
  assert.equal(open.reanchor, true)

  const k1 = scopeRetention.apply(session, epoch, 'todowrite-for-manager', 'run2', 'c2', 'b2', { kind: 'keepLast' })
  assert.equal(k1.ok, true)
  assert.equal(k1.remaining, 1)

  const k2 = scopeRetention.apply(session, epoch, 'todowrite-for-manager', 'run3', 'c3', 'b3', { kind: 'keepLast' })
  assert.equal(k2.ok, true)
  assert.equal(k2.remaining, 0)

  const blocked = scopeRetention.apply(session, epoch, 'todowrite-for-manager', 'run4', 'c4', 'b4', { kind: 'keepLast' })
  assert.equal(blocked.ok, false)
  assert.match(blocked.reason, /exhausted|resetScope/)

  const deliverOk = scopeRetention.apply(session, epoch, 'deliver', 'run5', 'c5', 'b5', { kind: 'keepLast' })
  assert.equal(deliverOk.ok, true)
})

test('same turn: one real + meToo; second real refused; lone meToo refused', () => {
  const { session, epoch } = fresh()
  scopeRetention.apply(session, epoch, 'resetScope', 'r0', 'c0', 'b0', {
    kind: 'resetScope',
    newScopeGoal: 'g',
    newScopeRetentionBudget: 5,
  })
  const lone = scopeRetention.apply(session, epoch, 'read', 'runA', 'cA', 'bA', { kind: 'meToo' })
  assert.equal(lone.ok, false)

  const keep = scopeRetention.apply(session, epoch, 'read', 'runB', 'cB1', 'bB', { kind: 'keepLast' })
  assert.equal(keep.ok, true)
  const me = scopeRetention.apply(session, epoch, 'write', 'runB', 'cB2', 'bB', { kind: 'meToo' })
  assert.equal(me.ok, true)
  const second = scopeRetention.apply(session, epoch, 'bash', 'runB', 'cB3', 'bB', { kind: 'keepLast' })
  assert.equal(second.ok, false)
})

test('removeLast does not decrement; streaks; projection; journal restore', () => {
  const { session, epoch } = fresh('s2', '9')
  scopeRetention.apply(session, epoch, 'resetScope', 'r0', 'c0', 'b0', {
    kind: 'resetScope',
    newScopeGoal: 'g',
    newScopeRetentionBudget: 3,
  })
  // establish a previous beat id via keep
  scopeRetention.apply(session, epoch, 'read', 'r1', 'c1', 'beat-prev', { kind: 'keepLast' })
  const before = scopeRetention.status(session).remaining

  const rm1 = scopeRetention.apply(session, epoch, 'read', 'r2', 'c2', 'beat-rm1', {
    kind: 'removeLast',
    replacement: '教训：不该空等。无世界副作用。',
  })
  assert.equal(rm1.ok, true)
  assert.equal(rm1.removeStreak, 1)
  assert.equal(scopeRetention.status(session).remaining, before)
  assert.match(rm1.replacement, /连续第 1 次空转/)

  const rm2 = scopeRetention.apply(session, epoch, 'read', 'r3', 'c3', 'beat-rm2', {
    kind: 'removeLast',
    replacement: '教训：还是别空转。',
  })
  assert.equal(rm2.removeStreak, 2)
  const rm3 = scopeRetention.apply(session, epoch, 'read', 'r4', 'c4', 'beat-rm3', {
    kind: 'removeLast',
    replacement: '教训：第三次。',
  })
  assert.equal(rm3.advisorDue, true)
  assert.equal(scopeRetention.status(session).advisorDue, true)

  const proj = scopeRetention.projection(session, 'beat-prev')
  assert.equal(proj.retracted, true)

  const events = scopeRetention.journal(session)
  scopeRetention.clear(session)
  scopeRetention.restore(session, epoch, events)
  assert.equal(scopeRetention.status(session).remaining, before)
  assert.equal(scopeRetention.status(session).removeStreak >= 3, true)
})

test('budget hard cap', () => {
  const { session, epoch } = fresh('s3', '1')
  const over = scopeRetention.apply(session, epoch, 'resetScope', 'r', 'c', 'b', {
    kind: 'resetScope',
    newScopeGoal: 'g',
    newScopeRetentionBudget: (MaxRetentionBudget ?? 48) + 1,
  })
  assert.equal(over.ok, false)
})

test('durable journal round-trip restores retention and retractions', () => {
  const streams = new Map()
  const journalFor = () => ({
    read(stream) {
      return streams.get(stream) ?? []
    },
    append(stream, expectedRevision, _requestId, body) {
      const frames = streams.get(stream) ?? []
      if (frames.length !== expectedRevision) return { status: 'RevisionConflict' }
      frames.push(body)
      streams.set(stream, frames)
      return { status: 'Committed' }
    },
    close() {},
  })
  scopeRetention.clear('dur')
  scopeRetention.configureJournal(journalFor)
  scopeRetention.reset('dur', 'ep1')
  scopeRetention.apply('dur', 'ep1', 'resetScope', 'r0', 'c0', 'b0', {
    kind: 'resetScope',
    newScopeGoal: 'g',
    newScopeRetentionBudget: 4,
  })
  scopeRetention.apply('dur', 'ep1', 'read', 'r1', 'c1', 'beat-a', { kind: 'keepLast' })
  scopeRetention.apply('dur', 'ep1', 'read', 'r2', 'c2', 'beat-b', {
    kind: 'removeLast',
    replacement: '教训：测试持久化。',
  })
  const mid = scopeRetention.status('dur')
  assert.equal(mid.remaining, 3)
  assert.equal(mid.removeStreak, 1)

  // Drop memory and reload via ensureEpoch + configureJournal
  scopeRetention.clear('dur')
  scopeRetention.configureJournal(journalFor)
  scopeRetention.ensureEpoch('dur', 'ep1')
  const again = scopeRetention.status('dur')
  assert.equal(again.remaining, 3)
  assert.equal(again.removeStreak, 1)
  const list = scopeRetention.retractions('dur')
  assert.equal(list.length, 1)
  assert.equal(list[0].beatId, 'beat-a')
})

test('removeLast stores aliases; projection matches callId alias', () => {
  const { session, epoch } = fresh('alias', '1')
  scopeRetention.apply(session, epoch, 'resetScope', 'run0', 'c0', 'b0', {
    kind: 'resetScope',
    newScopeGoal: 'g',
    newScopeRetentionBudget: 5,
  })
  scopeRetention.apply(session, epoch, 'read', 'provider-run-9', 'call-keep', 'provider-run-9', { kind: 'keepLast' })
  const rm = scopeRetention.apply(session, epoch, 'read', 'provider-run-10', 'call-rm', 'provider-run-10', {
    kind: 'removeLast',
    replacement: 'lesson: alias match',
  })
  assert.equal(rm.ok, true)
  assert.equal(rm.beatId, 'provider-run-9')
  const list = scopeRetention.retractions(session)
  assert.equal(list.length, 1)
  assert.ok(list[0].aliases.includes('provider-run-9'))
  assert.ok(list[0].aliases.includes('call-keep'))
  const byCall = scopeRetention.projection(session, 'call-keep')
  assert.equal(byCall.retracted, true)
  assert.match(byCall.replacement, /lesson: alias match/)
})

test('seed after reset opens retention on new epoch', () => {
  const session = 'seed-s'
  scopeRetention.clear(session)
  scopeRetention.reset(session, '2')
  assert.equal(scopeRetention.status(session).known, false)
  scopeRetention.seed(session, 7)
  const st = scopeRetention.status(session)
  assert.equal(st.known, true)
  assert.equal(st.remaining, 7)
})
