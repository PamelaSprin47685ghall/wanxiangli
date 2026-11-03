import test from 'node:test'
import assert from 'node:assert/strict'
import { ChangeHistory, ChangeJob, ChangeRuntime } from 'wanxiangli/change'
const ok = value => ({ ok: true, value })
const fail = error => ({ ok: false, error })
const apply = (history, event) => { const result = history.apply(event); assert.equal(result.ok, true, result.error); return result.history }
const created = { kind: 'ManagerJobCreated', id: 'job', session: 'session', agent: 'manager', byname: 'main', worktreeIdentity: 'branch', worktreePath: '/work', target: 'main', targetBranchFrozen: 'main' }
function publication() {
  let history = apply(new ChangeHistory(), created)
  history = apply(history, { kind: 'RebasedCandidateReady', id: 'job', commit: 'candidate', target: 'base' })
  const calls = []
  const effects = {
    history: () => history,
    append: async event => { calls.push(event.kind); history = apply(history, event); return ok(null) },
    git: { readHead: async () => ok('candidate'), targetHead: async () => ok('base'), conflictedFiles: async () => ok([]), rebase: async () => ok(null), ffMerge: async () => { calls.push('ff'); return ok('candidate') } },
    relay: { prepareCandidate: async () => ok('candidate'), continueLoop: async () => ok(null), awaitSignal: async () => ok({kind: 'Candidate'}), terminateResources: async () => { calls.push('terminate') } },
    acquireGate: async () => ({release: async () => { calls.push('release-gate') }}), sha256: String, isCancellation: error => error?.cancelled === true,
  }
  return { effects, calls, get history() { return history } }
}

test('ChangeJob releases its publication gate before cleanup and retains a landed pending-cleanup verdict', async () => {
  const f = publication()
  const result = await new ChangeJob().run({ id: 'job', target: 'main', path: '/work', release: async () => { f.calls.push('release-tree'); return fail('cleanup failed') } }, f.effects)
  assert.deepEqual(result, {kind: 'PublishedPendingCleanup', id: 'job', head: 'candidate', error: 'cleanup failed'})
  assert.deepEqual(f.calls, ['PublishClaimed', 'ff', 'Published', 'release-gate', 'terminate', 'release-tree'])
  assert.equal(f.history.job('job').terminal.kind, 'Published')
})

test('ChangeJob retains the second candidate preparation after a failed preparation with no conflicts', async () => {
  const f = publication()
  let prepared = 0
  f.effects.relay.prepareCandidate = async () => ++prepared === 1 ? fail('try first') : ok('candidate')
  const result = await new ChangeJob().run({ id: 'job', target: 'main', path: '/work', release: async () => ok(null) }, f.effects)
  assert.equal(result.kind, 'Published')
  assert.equal(prepared, 2)
})

test('ChangeRuntime never creates before the request fact and keeps the physical resource after durable manager admission fails', async () => {
  for (const failing of ['request', 'session', 'created']) {
    let history = new ChangeHistory()
    const calls = []
    const publication = {
      history: () => history,
      append: async event => {
        calls.push(event.kind)
        if ((failing === 'request' && event.kind === 'WorktreeCreateRequested') || (failing === 'created' && event.kind === 'WorktreeCreated')) return fail('write failed')
        history = apply(history, event); return ok(null)
      },
      acquireGate: async () => ({release: async () => { calls.push('gate-release') }}),
    }
    const resource = {identity: 'branch', path: '/work', markDurable: () => calls.push('durable'), release: async () => { calls.push('tree-release'); return fail('release ignored') }}
    const runtime = new ChangeRuntime({publication, worktrees: {create: async () => { calls.push('create'); return ok(resource) }, adopt: () => resource, list: async () => ok([])}, repoPath: '/repo', durable: true, isDirty: async () => ok([]), createSession: async () => { calls.push('session'); return fail('session failed') }, activate: async () => { throw new Error('must not activate') }, startJob: () => assert.fail('must not start'), publish: () => assert.fail('must not publish'), formatError: String})
    const result = await runtime.start({id: 'job', agent: 'manager', byname: 'main', prompt: 'change', path: '/work', identity: 'branch', target: 'main'})
    assert.equal(result.ok, false)
    if (failing === 'request') assert.deepEqual(calls, ['WorktreeCreateRequested'])
    if (failing === 'session') { assert.ok(calls.indexOf('WorktreeCreated') < calls.indexOf('session')); assert.ok(calls.includes('durable')); assert.ok(!calls.includes('tree-release')) }
    if (failing === 'created') { assert.ok(calls.includes('tree-release')); assert.match(result.error.error, /persist worktree created: write failed/); assert.ok(!calls.includes('session')) }
  }
})
