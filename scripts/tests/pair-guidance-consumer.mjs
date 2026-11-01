import assert from 'node:assert/strict'
import { PairGuidanceHistory, PairGuidanceOccurrences } from 'wanxiangli/pair-hint'
const empty = new PairGuidanceHistory()
const first = empty.append({ordinal:1n,callId:'one',markerText:'original\0',placementKey:'s|a:x',metadata:{anchor:'x'}})
assert.equal(first.ok,true)
assert.equal(empty.history().length,0)
assert.equal(first.value.reanchor().visible().length,0)
assert.equal(first.value.history()[0].markerText,'original\0')
let appended
const result = await new PairGuidanceOccurrences().occur({history:[],visible:[],occupied:[],syntheticCallIds:[],placement:{ok:true,value:{callGapKey:'Start',resultGapKey:'After:x',metadata:'x'}},skipNew:false,sessionKey:'session',markerText:'verbatim\0'}, rows=>({ok:true,value:rows}),async row=>{appended=row;return {ok:true,value:null}})
assert.equal(result.ok,true)
assert.equal(result.value.appended,true)
assert.equal(result.value.wire[0],appended)
assert.equal(appended.ordinal,1n)
console.log(JSON.stringify({pairGuidance:true}))
