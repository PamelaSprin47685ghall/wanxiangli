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

test('same turn: one real + meToo; second real refused', () => {
  const { session, epoch } = fresh()
  scopeRetention.apply(session, epoch, 'resetScope', 'r0', 'c0', 'b0', {
    kind: 'resetScope',
    newScopeGoal: 'g',
    newScopeRetentionBudget: 5,
  })
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

test('exempt tools are lifecycle-neutral: never spend, never decide, any order', () => {
  const { session, epoch } = fresh('s-exempt', '1')
  scopeRetention.apply(session, epoch, 'resetScope', 'r0', 'c0', 'b0', {
    kind: 'resetScope',
    newScopeGoal: 'g',
    newScopeRetentionBudget: 2,
  })
  const ask = scopeRetention.apply(session, epoch, 'askPreviousScope', 'r1', 'c1', 'b1', { kind: 'keepLast' })
  assert.equal(ask.ok, true)
  assert.equal(ask.remaining, 2)
  assert.equal(ask.decremented, false)
  // the ask does not decide the turn: the ordinary sibling still names the real annotation
  const real1 = scopeRetention.apply(session, epoch, 'todowrite-for-engineer', 'r1', 'c2', 'b1', { kind: 'keepLast' })
  assert.equal(real1.ok, true)
  assert.equal(real1.remaining, 1)
  // an exempt keepLast after the real one is not a second real annotation
  const askAfter = scopeRetention.apply(session, epoch, 'askPrevious', 'r1', 'c2b', 'b1', { kind: 'keepLast' })
  assert.equal(askAfter.ok, true)
  assert.equal(scopeRetention.status(session).remaining, 1)

  // exhausted: the ask is still accepted and still spends nothing
  scopeRetention.apply(session, epoch, 'read', 'r2', 'c3', 'b2', { kind: 'keepLast' })
  assert.equal(scopeRetention.status(session).remaining, 0)
  const askAtZero = scopeRetention.apply(session, epoch, 'askPreviousScope', 'r3', 'c4', 'b3', { kind: 'keepLast' })
  assert.equal(askAtZero.ok, true)
  assert.equal(scopeRetention.status(session).remaining, 0)
})

test('meToo is order-independent inside a turn', () => {
  const { session, epoch } = fresh('s-order', '1')
  scopeRetention.apply(session, epoch, 'resetScope', 'r0', 'c0', 'b0', {
    kind: 'resetScope',
    newScopeGoal: 'g',
    newScopeRetentionBudget: 5,
  })
  // meToo first, real annotation second
  const early = scopeRetention.apply(session, epoch, 'read', 'r1', 'c1', 'b1', { kind: 'meToo' })
  assert.equal(early.ok, true)
  assert.equal(early.provisional, true)
  const early2 = scopeRetention.apply(session, epoch, 'grep', 'r1', 'c2', 'b1', { kind: 'meToo' })
  assert.equal(early2.ok, true)
  const real = scopeRetention.apply(session, epoch, 'edit', 'r1', 'c3', 'b1', { kind: 'keepLast' })
  assert.equal(real.ok, true)
  assert.equal(real.remaining, 4)
  const late = scopeRetention.apply(session, epoch, 'bash', 'r1', 'c4', 'b1', { kind: 'meToo' })
  assert.equal(late.ok, true)
  assert.equal(late.provisional, undefined)

  // the same batch in the other order spends exactly the same
  scopeRetention.apply(session, epoch, 'edit', 'r2', 'c5', 'b2', { kind: 'keepLast' })
  scopeRetention.apply(session, epoch, 'read', 'r2', 'c6', 'b2', { kind: 'meToo' })
  assert.equal(scopeRetention.status(session).remaining, 3)
  assert.equal(scopeRetention.settle(session, 'r1').length, 0, 'decided run refuses nothing')
})

test('an all-meToo turn is refused outright: nothing charged, nothing journaled, no carry-over', () => {
  const { session, epoch } = fresh('s-allmetoo', '1')
  scopeRetention.apply(session, epoch, 'resetScope', 'r0', 'c0', 'b0', {
    kind: 'resetScope',
    newScopeGoal: 'g',
    newScopeRetentionBudget: 3,
  })
  const first = scopeRetention.apply(session, epoch, 'read', 'r1', 'c1', 'b1', { kind: 'meToo' })
  assert.equal(first.ok, true)
  assert.equal(first.provisional, true, 'held, not decided')
  assert.equal(scopeRetention.apply(session, epoch, 'grep', 'r1', 'c2', 'b1', { kind: 'meToo' }).ok, true)
  // the run's calls are all in and none was real: the turn is refused
  assert.deepEqual(Array.from(scopeRetention.settle(session, 'r1')), ['c1', 'c2'])
  assert.equal(scopeRetention.status(session).remaining, 3, 'refused, not charged')
  assert.equal(scopeRetention.journal(session).some((row) => row.kind === 'MeTooOrphan'), false)
  // a straggler meToo of the refused run is refused at once
  const late = scopeRetention.apply(session, epoch, 'bash', 'r1', 'c2b', 'b1', { kind: 'meToo' })
  assert.equal(late.ok, false)
  assert.match(late.reason, /carried only meToo and is refused/)
  // settling again, or settling a decided run, refuses nothing
  assert.deepEqual(Array.from(scopeRetention.settle(session, 'r1')), [])
  // the next turn starts clean: meToo is held again, a real annotation releases it
  assert.equal(scopeRetention.apply(session, epoch, 'read', 'r2', 'c3', 'b2', { kind: 'meToo' }).provisional, true)
  const real = scopeRetention.apply(session, epoch, 'edit', 'r2', 'c4', 'b2', { kind: 'keepLast' })
  assert.equal(real.ok, true)
  assert.equal(real.decided, true)
  assert.deepEqual(Array.from(real.released), ['c3'])
  assert.equal(real.remaining, 2)
  assert.deepEqual(Array.from(scopeRetention.settle(session, 'r2')), [])

  // journal replay sees only the real keep
  const events = scopeRetention.journal(session)
  scopeRetention.clear(session)
  scopeRetention.restore(session, epoch, events)
  assert.equal(scopeRetention.status(session).remaining, 2)
})

test('exempt calls never rescue an all-meToo turn', () => {
  const { session, epoch } = fresh('s-allmetoo-exempt', '1')
  scopeRetention.apply(session, epoch, 'resetScope', 'r0', 'c0', 'b0', {
    kind: 'resetScope',
    newScopeGoal: 'g',
    newScopeRetentionBudget: 2,
  })
  assert.equal(scopeRetention.apply(session, epoch, 'read', 'r1', 'c1', 'b1', { kind: 'meToo' }).provisional, true)
  const ask = scopeRetention.apply(session, epoch, 'askPreviousScope', 'r1', 'c2', 'b1', { kind: 'keepLast' })
  assert.equal(ask.ok, true)
  assert.equal(ask.decided, undefined, 'exempt keepLast does not decide the turn')
  assert.deepEqual(Array.from(scopeRetention.settle(session, 'r1')), ['c1'])
  assert.equal(scopeRetention.status(session).remaining, 2)
})

test('meToo ahead of the resetScope that opens or reopens the scope', () => {
  const { session, epoch } = fresh('s-reset-order', '1')
  // uninitialized session: a sibling meToo may arrive before the opening reset
  assert.equal(scopeRetention.apply(session, epoch, 'read', 'r1', 'c1', 'b1', { kind: 'meToo' }).ok, true)
  const open = scopeRetention.apply(session, epoch, 'bash', 'r1', 'c2', 'b1', {
    kind: 'resetScope',
    newScopeGoal: 'g',
    newScopeRetentionBudget: 1,
  })
  assert.equal(open.ok, true)
  scopeRetention.apply(session, epoch, 'read', 'r2', 'c3', 'b2', { kind: 'keepLast' })
  // exhausted: meToo first, then the reopening reset
  assert.equal(scopeRetention.apply(session, epoch, 'read', 'r3', 'c4', 'b3', { kind: 'meToo' }).ok, true)
  const reopen = scopeRetention.apply(session, epoch, 'bash', 'r3', 'c5', 'b3', {
    kind: 'resetScope',
    newScopeGoal: 'g2',
    newScopeRetentionBudget: 2,
  })
  assert.equal(reopen.ok, true)
  assert.equal(scopeRetention.status(session).remaining, 2)
})
