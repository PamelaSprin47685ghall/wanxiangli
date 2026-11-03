import test from 'node:test'
import assert from 'node:assert/strict'
import {FissionHistory} from 'wanxiangli/fission-group'
const admitted={kind:'admitted',groupId:'g',owner:'owner',parent:null,origin:'call',count:2,sessions:['a','b'],prompts:['one','two'],reference:'ref:owner',digest:'digest:owner',before:['prior']}
const event=(kind,fields={})=>({kind,groupId:'g',owner:'owner',...fields})
const applied=(history,fact)=>{const result=history.apply(fact);assert.equal(result.ok,true,result.rejection);return result.history}

test('history owns immutable group and lane indexes with idempotent admission',()=>{
  const empty=new FissionHistory(), first=applied(empty,admitted)
  assert.equal(empty.group('g'),null)
  assert.equal(first.apply(admitted).history,first)
  assert.equal(first.ownerOfLane('a'),'owner')
  assert.equal(first.membership('b').laneIndex,1)
  assert.equal(first.activeForOwner('owner').id,'g')
  const view=first.group('g'); view.sessions[0][1]='changed'; view.before.push('new')
  assert.deepEqual(first.group('g').sessions,[[0,'a'],[1,'b']])
  assert.deepEqual(first.group('g').before,['prior'])
  assert.equal(first.apply({...admitted,groupId:'other'}).rejection,'DuplicateOwnerActive')
  assert.equal(first.apply({...admitted,prompts:['different','two']}).rejection,'ConflictingGroup')
})

test('history preserves unknown-group and lane refusal ordering without mutation',()=>{
  const empty=new FissionHistory()
  assert.equal(empty.apply(event('laneMaterialized',{laneIndex:-1,session:'wrong',run:'r',reference:'ref',digest:'d'})).rejection,'UnknownGroup')
  const first=applied(empty,admitted)
  assert.equal(first.apply(event('laneMaterialized',{laneIndex:-1,session:'wrong',run:'r',reference:'ref',digest:'d'})).rejection,'InvalidLane')
  assert.equal(first.apply(event('laneMaterialized',{laneIndex:0,session:'wrong',run:'r',reference:'ref',digest:'d'})).rejection,'LaneSessionMismatch')
  assert.deepEqual(first.group('g').work,[])
})

test('history retains pre-group deliveries and work through takeover and terminal replay',()=>{
  let history=applied(new FissionHistory(),admitted)
  assert.equal(history.convergenceReady('g'),false)
  history=applied(history,event('completionCaptured',{completion:'prior',reference:'ref:prior',digest:'digest:prior'}))
  for (const [laneIndex,session] of ['a','b'].entries()) {
    history=applied(history,event('laneMaterialized',{laneIndex,session,run:'r'+laneIndex,reference:'ref:'+session,digest:'digest:'+session}))
    history=applied(history,event('completionDelivered',{completion:'prior',laneIndex}))
  }
  assert.equal(history.convergenceReady('g'),true)
  const detached=history.group('g')
  detached.work[0][1][0]='changed-work'
  detached.captured[0][1][0]='changed-prior'
  assert.equal(history.group('g').work[0][1][0],'ref:a')
  assert.equal(history.group('g').captured[0][1][0],'ref:prior')
  history=applied(history,event('externalAffinityBound',{external:'agent',laneIndex:1}))
  history=applied(history,event('takeover',{laneIndex:1,session:'b',prompt:'prompt',physical:null,reference:'aggregate',digest:'d'}))
  const open=history
  const terminal=event('converged',{session:'b',run:'terminal',reference:'aggregate',digest:'d'})
  history=applied(history,terminal)
  assert.equal(open.activeForOwner('owner').id,'g')
  assert.equal(history.activeForOwner('owner'),null)
  assert.equal(history.latestForOwner('owner').terminal.kind,'Converged')
  assert.equal(history.ownerOfLane('b'),'owner')
  assert.equal(history.apply(terminal).history,history)
  assert.equal(history.apply(event('failed',{reason:'different'})).rejection,'TerminalAlreadySet')
})

test('failed terminal keeps latest and old branch while removing only active owner',()=>{
  const open=applied(new FissionHistory(),admitted)
  const failure=event('failed',{reason:'stop'})
  const closed=applied(open,failure)
  assert.equal(closed.apply(failure).history,closed)
  assert.deepEqual(closed.activeGroups(),[])
  assert.equal(closed.latestForOwner('owner').terminal.reason,'stop')
  assert.equal(open.activeGroups().length,1)
})
