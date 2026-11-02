import assert from 'node:assert/strict'
import {FissionHistory,FissionLifecycle,fissionRuntime,fissionAdmissionRegistry} from 'wanxiangli/fission-group'
const lifecycle=new FissionLifecycle()
let history=new FissionHistory(), counter=0, disposed=0
const blobs=new Map(), events=[], actions=[]
const ok=value=>({ok:true,value})
const writeBlob=async text=>{const reference=`blob:${++counter}`;blobs.set(reference,text);return ok({reference,digest:reference})}
const append=async fact=>{const result=history.apply(fact);assert.equal(result.ok,true,result.rejection);history=result.history;events.push(fact.kind);return ok()}
const effects={
  history:()=>history,append,writeBlob,
  readBlob:async reference=>ok(blobs.get(reference)), ownerAuthority:()=>({role:'worker'}),
  retireCompletion:async()=>true,
  sendTakeover:async(session,authority,aggregate)=>{assert.equal(session,'lane:1');assert.equal(authority.role,'worker');assert.ok(aggregate.indexOf('[lane.0]')<aggregate.indexOf('[lane.1]'));assert.match(aggregate,/shared prior/);actions.push('takeover-send');return ok('takeover-prompt')},
  report(kind,_,detail){throw Error(`${kind}: ${JSON.stringify(detail)}`)},
  abortSession:async()=>ok(),notifyFailed:()=>true,
  publishOwner:async()=>{actions.push('published');assert.equal(history.group('group').terminal.kind,'Open');return ok(true)},
  readDelivery:observation=>observation.material, isExternalRetired:()=>true,nudge:async()=>({kind:'kept'}),
}
const admitted=await lifecycle.admit({owner:'owner',count:2,lanes:[{index:0,prompt:'one'},{index:1,prompt:'two'}]}, {
  parentOf:async()=>ok('parent'),ownerView:async()=>ok('owner context'),
  createLane:async(owner,parent,lane)=>{assert.equal(parent,'parent');const session=`lane:${lane.index}`;fissionRuntime.bindLane('group',owner,lane.index,2,session);return ok(session)},
  renderStartup:(_,lane)=>lane.prompt,startLane:async(session,prompt)=>{actions.push(`start:${session}:${prompt}`);return ok()},abortLane:async()=>{},
  interruptOwner:async()=>{actions.push('interrupt');return ok()},
  onLanesCreated:async(owner,parent,ownerView,lanes)=>{const written=await writeBlob(ownerView);await append({kind:'admitted',groupId:'group',owner,parent,origin:'origin',count:2,sessions:lanes.map(l=>l.session),prompts:lanes.map(l=>l.prompt),...written.value,before:['prior']});fissionRuntime.trackGroupResource('group',{dispose(){disposed++}});return ok()},
  onFailed:async()=>assert.fail('unexpected launch failure'),
})
assert.equal(admitted.ok,true)
assert.deepEqual(actions,['start:lane:0:one','start:lane:1:two','interrupt'])
await lifecycle.broadcast({id:'group',owner:'owner',lanes:admitted.value.lanes,completion:'prior',payload:'shared prior'}, {
  history:()=>history,append,writeBlob,sendShared:async(_,lane)=>{actions.push(`shared:${lane.index}`);return ok(true)},canConverge:true,
  revision:()=>events.length,awaitChange:async()=>assert.fail('not yet ready'),converge:owner=>lifecycle.converge(owner,effects),report:effects.report,
})
for(const lane of [0,1]) assert.equal(await lifecycle.observe({session:`lane:${lane}`,run:`run:${lane}`,outcome:'Completed',canNudge:false,material:`work ${lane}`},effects),true)
assert.equal(history.group('group').takeover.session,'lane:1')
assert.equal(await lifecycle.observe({session:'lane:0',run:'late',outcome:'ExternalAbort',reason:'late',canNudge:false},effects),true)
assert.equal(history.group('group').terminal.kind,'Open')
assert.equal(await lifecycle.observe({session:'lane:1',run:'final',outcome:'Completed',canNudge:false},effects),true)
assert.equal(history.group('group').terminal.kind,'Converged')
assert.equal(actions.at(-1),'published')
assert.equal(events.at(-1),'converged')
assert.equal(disposed,1)
assert.equal(lifecycle.isActive('owner'),false)
assert.equal(fissionRuntime.tryLane('lane:0'),undefined)
fissionRuntime.clearAll();fissionAdmissionRegistry.clear()
console.log(JSON.stringify({fissionLifecycle:true}))
