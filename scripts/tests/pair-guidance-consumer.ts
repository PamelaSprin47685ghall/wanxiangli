import { PairGuidanceHistory, PairGuidanceOccurrences, type PairGuidanceOccurrence } from 'wanxiangli/pair-hint'
const history = new PairGuidanceHistory<{anchor:string}>()
const next = history.append({ordinal:1n,callId:'one',markerText:'text',placementKey:'s|a:x',metadata:{anchor:'x'}})
if(next.ok) {
  const ordinal: bigint = next.value.nextOrdinal()
  const anchor: string = next.value.history()[0].metadata.anchor
  void ordinal; void anchor
}
const result = await new PairGuidanceOccurrences().occur<string, readonly PairGuidanceOccurrence<string>[], Error>({history:[],visible:[],occupied:[],syntheticCallIds:[],placement:{ok:true,value:{callGapKey:'Start',resultGapKey:'After:x',metadata:'x'}},skipNew:false,sessionKey:'session',markerText:'text'}, rows=>({ok:true,value:rows}),async()=>({ok:true,value:null}))
if (result.ok) { const text:string = result.value.wire[0].markerText; void text }
// @ts-expect-error durable ordinal remains bigint
history.append({ordinal:1,callId:'bad',markerText:'',placementKey:'',metadata:{anchor:''}})
