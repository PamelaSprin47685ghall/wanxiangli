import assert from 'node:assert/strict'
import { ChangeHistory, ChangeRuntime, ChangeJob } from 'wanxiangli/change'

const success = value => ({ ok: true, value })
let history = new ChangeHistory()
const calls = []
let head = 'base', targetHead = 'base', ff = 0
const apply = event => { const next = history.apply(event); assert.equal(next.ok, true, next.error); history = next.history }
const resource = { identity: 'manager/job', path: '/work', release: async () => { calls.push('release'); return success(null) }, markDurable: () => calls.push('durable') }
const publication = {
  history: () => history,
  append: async event => { calls.push(event.kind); apply(event); return success(null) },
  git: {
    readHead: async () => success(head), targetHead: async () => success(targetHead),
    conflictedFiles: async () => success([]),
    rebase: async () => { calls.push('rebase'); head = 'candidate'; return success(null) },
    ffMerge: async (_path, _target, expected, candidate) => { assert.equal(targetHead, expected); calls.push('ff'); ff++; targetHead = candidate; return success(candidate) },
  },
  relay: {
    prepareCandidate: async () => success('candidate'), continueLoop: async () => { calls.push('continue'); return success(null) },
    awaitSignal: async () => success({ kind: 'Candidate' }),
    terminateResources: async () => { calls.push('terminate') },
  },
  acquireGate: async () => { calls.push('gate'); return { release: async () => { calls.push('ungate') } } },
  sha256: text => text,
  isCancellation: () => false,
}
let delivered
const completion = new Promise(resolve => { delivered = resolve })
const runtime = new ChangeRuntime({
  publication,
  worktrees: { create: async () => { calls.push('create'); return success(resource) }, adopt: () => resource, list: async () => success([]) },
  repoPath: '/repo', durable: true, isDirty: async () => success([]),
  createSession: async () => { calls.push('session'); return success('manager-session') },
  activate: async () => { calls.push('activate'); return success(null) },
  startJob: () => calls.push('start'), publish: delivered, formatError: String,
})
const admitted = await runtime.start({ id: 'job', agent: 'manager', byname: 'main', prompt: 'change', path: '/work', identity: 'manager/job', target: 'refs/heads/main' })
assert.equal(admitted.ok, true)
assert.equal((await completion).kind, 'Published')
assert.equal(history.job('job').terminal.head, 'candidate')
assert.equal(ff, 1)
assert.ok(calls.indexOf('WorktreeCreateRequested') < calls.indexOf('create'))
assert.ok(calls.indexOf('WorktreeCreated') < calls.indexOf('session'))
assert.ok(calls.indexOf('ManagerJobCreated') < calls.indexOf('activate'))
assert.ok(calls.indexOf('PublishClaimed') < calls.indexOf('ff'))
assert.ok(calls.indexOf('ff') < calls.indexOf('Published'))
assert.ok(calls.lastIndexOf('ungate') < calls.indexOf('terminate'))

history = new ChangeHistory()
apply({ kind: 'ManagerJobCreated', id: 'job', session: 'manager-session', agent: 'manager', byname: 'main', worktreeIdentity: 'manager/job', worktreePath: '/work', target: 'refs/heads/main', targetBranchFrozen: 'refs/heads/main' })
apply({ kind: 'RebasedCandidateReady', id: 'job', commit: 'candidate', target: 'base' })
apply({ kind: 'PublishClaimed', id: 'job', target: 'refs/heads/main', commit: 'candidate', expected: 'base' })
const recovered = await new ChangeJob().run({ id: 'job', target: 'refs/heads/main', path: '/work', release: resource.release }, publication)
assert.equal(recovered.kind, 'Published')
assert.equal(ff, 1, 'recovery of landed claim must not issue another fast-forward')
console.log(JSON.stringify({ change: true }))
