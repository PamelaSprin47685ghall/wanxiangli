import { ChangeHistory, ChangeJob, ChangeRuntime, type ChangeCollaborators, type ChangeRuntimeEffects } from 'wanxiangli/change'
const history = new ChangeHistory()
const ok = <T>(value: T): {ok: true; value: T} => ({ok: true, value})
const collaborators: ChangeCollaborators = {
  history: () => history, append: async () => ok(null),
  git: { readHead: async () => ok('head'), targetHead: async () => ok('head'), conflictedFiles: async () => ok([]), rebase: async () => ok(null), ffMerge: async (_path, _target, _expected, candidate) => ok(candidate) },
  relay: { prepareCandidate: async () => ok('head'), continueLoop: async () => ok(null), awaitSignal: async () => ok({kind: 'Candidate' as const}), terminateResources: async () => {} },
  acquireGate: async () => ({ release: async () => {} }), sha256: value => value, isCancellation: () => false,
}
const resource = { identity: 'branch', path: '/work', release: async () => ok(null), markDurable: () => {} }
const effects: ChangeRuntimeEffects = { publication: collaborators, worktrees: { create: async () => ok(resource), adopt: () => resource, list: async () => ok([]) }, repoPath: '/repo', durable: false, isDirty: async () => ok([]), createSession: async () => ok('session'), activate: async () => ok(null), startJob: () => {}, publish: () => {}, formatError: String }
void new ChangeRuntime(effects)
void new ChangeJob().run({ id: 'job', target: 'main', path: '/work', release: resource.release }, collaborators)
