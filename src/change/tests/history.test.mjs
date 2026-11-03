import test from 'node:test'
import assert from 'node:assert/strict'
import { ChangeHistory } from 'wanxiangli/change'

const created = (id = 'job', byname = '') => ({kind:'ManagerJobCreated',id,session:`session-${id}`,agent:'manager',byname,worktreeIdentity:`tree-${id}`,worktreePath:`/work/${id}`,target:'refs/heads/main',targetBranchFrozen:'main'})
const apply = (history, event) => {
  const result = history.apply(event)
  assert.equal(result.ok, true, result.error)
  return result.history
}

test('Change history owns immutable job facts with original terminal and claim ordering', () => {
  const empty = new ChangeHistory()
  const first = apply(empty, created())
  assert.equal(empty.job('job'), null)
  assert.equal(first.job('job').byname, 'manager')
  assert.deepEqual(apply(first, {...created(),session:'replacement'}).job('job'), first.job('job'))
  assert.equal(apply(first,{kind:'CandidateReady',id:'unknown',commit:'ignored'}).job('unknown'), null)
  assert.deepEqual(first.apply({kind:'PublishClaimed',id:'job',target:'different',commit:'x',expected:'head'}),{ok:false,error:'PublishClaimedWithoutRebasedCandidate'})
  let history = apply(first,{kind:'CandidateReady',id:'job',commit:'initial'})
  history = apply(history,{kind:'RebasedCandidateReady',id:'job',commit:'rebased-1',target:'head-1'})
  history = apply(history,{kind:'RebasedCandidateReady',id:'job',commit:'rebased-2',target:'head-2'})
  history = apply(history,{kind:'PublishClaimed',id:'job',target:'other-target',commit:'rebased-2',expected:'other-head'})
  history = apply(history,{kind:'PublishClaimed',id:'job',target:'new-target',commit:'rebased-2',expected:'new-head'})
  assert.deepEqual(history.job('job').claim,{target:'new-target',commit:'rebased-2',expected:'new-head'})
  assert.equal(history.job('job').candidate.commit,'initial')
  history = apply(history,{kind:'Published',id:'job',candidate:'rebased-2',head:'rebased-2'})
  assert.equal(history.activeJobs().length,0)
  assert.deepEqual(history.apply({kind:'PublishClaimed',id:'job',target:'x',commit:'wrong',expected:'x'}),{ok:false,error:'PublishClaimedCommitMismatch'})
  assert.deepEqual(apply(history,{kind:'JobFailed',id:'job',reason:'late'}).job('job'),history.job('job'))
  assert.equal(first.job('job').candidate,null)
})

test('Change history detaches views and preserves alias ordering and independent worktree receipts', () => {
  let history = apply(new ChangeHistory(),created('z','Shared'))
  history = apply(history,created('a','shared'))
  assert.equal(history.jobByName('  SHARED ').id,'a')
  assert.equal(history.jobByName(' '),null)
  assert.equal(history.jobBySession('session-z').id,'z')
  const files = ['a.fs']
  history = apply(history,{kind:'ConflictDetected',id:'a',commit:'c',target:'h',files,digest:'d'})
  files.push('not-stored')
  const view = history.job('a')
  view.conflict.files.push('not-stored-either')
  assert.deepEqual(history.job('a').conflict.files,['a.fs'])
  history = apply(history,{kind:'WorktreeCreateRequested',id:'a',identity:'tree',path:'/first'})
  history = apply(history,{kind:'WorktreeCreateRequested',id:'z',identity:'tree',path:'/second'})
  assert.deepEqual(history.worktreeEffect('tree'),{kind:'Requested',id:'a',path:'/first'})
  history = apply(history,{kind:'WorktreeCreated',id:'z',identity:'tree',path:'/second'})
  history = apply(history,{kind:'WorktreeCreated',id:'a',identity:'tree',path:'/first'})
  assert.deepEqual(history.worktreeEffect('tree'),{kind:'Created',id:'z',path:'/second'})
})
