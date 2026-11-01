import {FissionHistory,FissionLifecycle,type FissionAdmissionEffects,type FissionObservationEffects,type FissionBroadcastEffects,type FissionHistoryEvent,type FissionResult} from 'wanxiangli/fission-group'
const lifecycle=new FissionLifecycle()
let history=new FissionHistory()
const ok=<T>(value:T):FissionResult<T>=>({ok:true,value})
const append=async(event:FissionHistoryEvent):Promise<FissionResult<void>>=>{
  const result=history.apply(event)
  if(!result.ok) return {ok:false,error:result.rejection}
  history=result.history
  return ok(undefined)
}
const admission:FissionAdmissionEffects={
  parentOf:async()=>ok('parent'),ownerView:async()=>ok(null),createLane:async(_,__,lane)=>ok(String(lane.index)),renderStartup:(_,lane)=>lane.prompt,
  startLane:async()=>ok(undefined),abortLane:async()=>{},interruptOwner:async()=>ok(undefined),onLanesCreated:async()=>ok(undefined),onFailed:async()=>{},
}
const effects:FissionObservationEffects<{role:string},{session:string,run:string,outcome:'Completed',canNudge:boolean,material:string}>={
  history:()=>history,append,readBlob:async()=>ok('material'),writeBlob:async()=>ok({reference:'ref',digest:'digest'}),
  ownerAuthority:()=>({role:'worker'}),retireCompletion:async()=>true,sendTakeover:async()=>ok('prompt'),report(){},
  abortSession:async()=>ok(undefined),notifyFailed:()=>true,publishOwner:async()=>ok(true),readDelivery:value=>value.material,isExternalRetired:()=>true,nudge:async()=>({kind:'kept'}),
}
const broadcast:FissionBroadcastEffects<number>={history:()=>history,append,writeBlob:effects.writeBlob,sendShared:async()=>ok(true),canConverge:true,revision:()=>0,awaitChange:async()=>{},converge:owner=>lifecycle.converge(owner,effects),report(){}}
void lifecycle.admit({owner:'owner',count:2,lanes:[{index:0,prompt:'one'},{index:1,prompt:'two'}]},admission)
void lifecycle.observe({session:'lane',run:'run',outcome:'Completed',canNudge:false,material:'work'},effects)
void lifecycle.broadcast({id:'group',owner:'owner',completion:'prior',payload:'prior',lanes:[]},broadcast)
