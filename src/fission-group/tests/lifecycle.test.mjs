import test from 'node:test'
import assert from 'node:assert/strict'
import {FissionHistory,FissionLifecycle,fissionRuntime,fissionAdmissionRegistry} from 'wanxiangli/fission-group'
const ok=value=>({ok:true,value})
const bad=error=>({ok:false,error})
const reset=()=>{fissionRuntime.clearAll();fissionAdmissionRegistry.clear()}
const admissionEffects=changes=>({parentOf:async()=>ok('parent'),ownerView:async()=>ok(null),createLane:async(_,__,lane)=>ok('lane:'+lane.index),renderStartup:(_,lane)=>lane.prompt,startLane:async()=>ok(),abortLane:async()=>{},interruptOwner:async()=>ok(),onLanesCreated:async()=>ok(),onFailed:async()=>{},...changes})
const request={owner:'owner',count:2,lanes:[{index:0,prompt:'one'},{index:1,prompt:'two'}]}
function state(before=[]){let history=new FissionHistory();const facts=[];const append=async fact=>{const applied=history.apply(fact);assert.equal(applied.ok,true);history=applied.history;facts.push(fact.kind);return ok()};return {history:()=>history,facts,append,init:()=>append({kind:'admitted',groupId:'group',owner:'owner',parent:'parent',origin:'call',count:2,sessions:['lane:0','lane:1'],prompts:['one','two'],reference:'owner',digest:'d',before})}}

test('partial launch commits before starts then fails and rolls back every created lane',async()=>{
  reset();const lifecycle=new FissionLifecycle(),steps=[]
  const result=await lifecycle.admit(request,admissionEffects({onLanesCreated:async()=>{steps.push('committed');return ok()},startLane:async session=>{steps.push('start:'+session);return session==='lane:1'?bad('refused'):ok()},onFailed:async()=>steps.push('failed'),abortLane:async session=>{steps.push('abort:'+session);if(session==='lane:0')throw Error('abort failed')}}))
  assert.deepEqual(steps,['committed','start:lane:0','start:lane:1','failed','abort:lane:0','abort:lane:1'])
  assert.equal(result.kind,'RuntimeUnavailable');assert.equal(result.error,'lane start failed: refused');assert.equal(lifecycle.isActive('owner'),false)
})

test('failed fact refusal leaves running lanes and reservation untouched',async()=>{
  reset();const lifecycle=new FissionLifecycle(),s=state();await s.init();fissionAdmissionRegistry.reserve('owner')
  const calls=[]
  await lifecycle.fail(s.history().group('group'),'reason',{append:async()=>bad('unknown commit'),abortSession:async()=>calls.push('abort'),notifyFailed:()=>calls.push('notify'),report:kind=>calls.push(kind)})
  assert.deepEqual(calls,['failure-append']);assert.equal(lifecycle.isActive('owner'),true);reset()
})

test('shared capture refusal still sends while refused send never records delivery and claims release',async()=>{
  reset();const lifecycle=new FissionLifecycle(),s=state(['prior']);await s.init();const reports=[]
  const effects={...s,writeBlob:async()=>bad('storage'),sendShared:async()=>bad('send rejected'),canConverge:false,report:kind=>reports.push(kind)}
  const broadcast={id:'group',owner:'owner',completion:'prior',payload:'payload',lanes:[{index:0,session:'lane:0',prompt:'one'},{index:1,session:'lane:1',prompt:'two'}]}
  await lifecycle.broadcast(broadcast,effects)
  assert.deepEqual(reports,['capture-write','shared-send','shared-send']);assert.deepEqual(s.facts,['admitted'])
  assert.equal(fissionRuntime.hasDeliveryClaim('group','prior',-1),false);assert.equal(fissionRuntime.hasDeliveryClaim('group','prior',0),false)
})

test('terminal publication rejection records failure before aborting and never records convergence',async()=>{
  reset();const lifecycle=new FissionLifecycle(),s=state();await s.init()
  for(const laneIndex of [0,1])await s.append({kind:'laneMaterialized',groupId:'group',owner:'owner',laneIndex,session:'lane:'+laneIndex,run:'run'+laneIndex,reference:'work',digest:'d'})
  await s.append({kind:'takeover',groupId:'group',owner:'owner',laneIndex:1,session:'lane:1',prompt:'prompt',physical:null,reference:'all',digest:'d'})
  fissionAdmissionRegistry.reserve('owner');for(const lane of [0,1])fissionRuntime.bindLane('group','owner',lane,2,'lane:'+lane)
  const calls=[]
  assert.equal(await lifecycle.observe({session:'lane:1',run:'final',outcome:'Completed',canNudge:false},{...s,publishOwner:async()=>{calls.push('publish');return bad('not delivered')},abortSession:async session=>{assert.equal(s.facts.at(-1),'failed');calls.push('abort:'+session);return ok()},notifyFailed:()=>{calls.push('notify');return true},report(){assert.fail('unexpected diagnostic')}}),true)
  assert.deepEqual(calls,['publish','abort:lane:0','abort:lane:1','notify']);assert.equal(s.history().group('group').terminal.reason,'not delivered');assert.equal(s.facts.includes('converged'),false);assert.equal(lifecycle.isActive('owner'),false)
})
