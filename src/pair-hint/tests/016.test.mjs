import test from 'node:test'
import assert from 'node:assert/strict'
import { PairHint } from '../../../dist/pair-hint/PairHint.js'
const u=key=>({kind:'user',operator:true,key,parts:[]})
const a=(...parts)=>({kind:'assistant',operator:false,parts})
const r=forId=>({kind:'result',resultFor:forId,operator:false,resultField:'content',parts:[]})
test('SPEC[pair-hint-016] old assistant text and thinking survive resets while ordinary tool parts and matching results disappear',()=>{
  const subject=PairHint()
  const history=[
    u('operator'),
    a({type:'reasoning',text:'reasoning preserved'},{type:'text',text:'assistant prose preserved'},
      {id:'read-old',tool:'read'},{resultFor:'read-old'},{id:'assume-old',tool:'assume'},{resultFor:'assume-old'}),
    r('read-old'),r('assume-old'),
    a({type:'text',text:'another old assistant statement'}),
    a({id:'reset-one',tool:'resetScope'}),r('reset-one'),
    a({type:'text',text:'new scope prose'},{id:'reset-two',tool:'resetScope'}),r('reset-two'),
  ]
  const slots=subject.planFilter(history)
  const find=index=>slots.find(slot=>slot.index===index)
  assert.deepEqual(Array.from(find(1).parts),[0,1,4,5],
    'reasoning, prose, always-retained tool call and inline result persist together')
  assert.equal(find(2),undefined,'old ordinary result removed')
  assert.equal(find(3).parts,null,'critical result message is retained in full, with original bytes')
  assert.equal(find(4).parts?.length,1,'another old assistant prose remains')
  assert.ok(find(5),'prior reset call still present')
  assert.ok(find(6),'prior reset result still present')
  assert.equal(history[1].parts[0].text,'reasoning preserved','raw message untouched')
})
