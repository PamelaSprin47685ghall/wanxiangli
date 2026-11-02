import test from 'node:test'
import assert from 'node:assert/strict'
import {TraceCapture,TraceHistory} from 'wanxiangli/trace'
const ok=value=>({ok:true,value})
const part=(key,extra={})=>({key,secondaryKey:null,compatibility:key,exactKey:false,legacyKey:key,role:'user',kind:'text',toolName:null,body:key,metadata:{key},...extra})
function store() {
  let current=new TraceHistory('capture')
  const identities=[], facts=[], calls=[]
  return {
    facts,calls,
    read:()=>({history:current,identities}),
    writeBody:async body=>{calls.push('blob:'+body);return ok({reference:'ref:'+body,digest:'digest:'+body})},
    append:async fact=>{
      calls.push('append:'+fact.kind)
      facts.push(fact)
      let result
      if(fact.kind==='opening') result=current.appendOpening({assignment:fact.assignment,requirements:fact.requirements})
      else if(fact.kind==='terminal') result=current.appendTerminal(fact)
      else {
        result=current.appendPart({...fact.part,sequence:fact.sequence,bodyRef:fact.bodyRef,bodyDigest:fact.bodyDigest,descriptor:fact.part.key})
        identities.push({key:fact.part.key,secondaryKey:fact.part.secondaryKey??null,compatibility:fact.part.compatibility??fact.part.key})
      }
      if(!result.ok) throw result.error
      current=result.value
    },
  }
}
test('capture writes body before each fact and keeps committed prefix after a write failure',async()=>{
  const owner=new TraceCapture(), target=store(), original=target.writeBody
  const cause={storage:'full'}
  target.writeBody=async body=>body==='bad'?{ok:false,error:cause}:original(body)
  const result=await owner.captureParts(target,[part('first'),part('bad'),part('later')],'positional')
  assert.equal(result.error,cause)
  assert.deepEqual(target.calls,['blob:first','append:part'])
  assert.equal(target.read().history.headSequence(),1n)
  assert.equal(target.facts.length,1)
})
test('capture keeps positional and stable identity decisions and batch-start indexes',async()=>{
  const owner=new TraceCapture(), target=store()
  await owner.captureParts(target,[part('legacy',{secondaryKey:'physical',compatibility:'same'})],'positional')
  await owner.captureParts(target,[part('legacy',{body:'changed'})],'positional')
  await owner.captureParts(target,[part('new',{secondaryKey:'physical'})],'stable')
  await owner.captureParts(target,[part('modern',{legacyKey:'legacy',compatibility:'same'})],'stable')
  assert.equal(target.facts.length,1)
  await owner.captureParts(target,[part('modern',{legacyKey:'legacy',compatibility:'different'})],'stable')
  assert.equal(target.facts.length,2)
  const fresh=store()
  await owner.captureParts(fresh,[part('same'),part('same')],'positional')
  assert.equal(fresh.facts.length,2,'same-batch repeats retain the original batch-start behavior')
})
test('capture serializes cursor allocation per key and releases a failed predecessor',async()=>{
  const owner=new TraceCapture(), target=store()
  await Promise.all([owner.run('session',()=>owner.captureParts(target,[part('one')],'positional')),owner.run('session',()=>owner.captureParts(target,[part('two')],'positional'))])
  assert.deepEqual(target.facts.map(f=>f.sequence),[1n,2n])
  const cause=Error('rejected'), failed=owner.run('session',async()=>{throw cause})
  const next=owner.run('session',async()=>42)
  await assert.rejects(failed,error=>error===cause)
  assert.equal(await next,42)
})
test('opening, terminal and reference capture preserve replay and receipt boundaries',async()=>{
  const owner=new TraceCapture(), target=store(), before=target.read().history
  await owner.captureOpening(target,' ',[])
  assert.equal(target.facts.length,0)
  await owner.captureOpening(target,'original\0',['verbatim'])
  await owner.captureOpening(target,'different',[])
  await owner.captureReference(target,part('last'),'ref:last','digest:last')
  await owner.captureReference(target,part('last'),'other','other')
  await owner.captureTerminalText(target,'run','answer','digest:answer')
  await owner.captureTerminalText(target,'run','answer','digest:answer')
  await owner.captureTerminalReference(target,'run','ref:answer','digest:answer')
  assert.equal(target.facts.length,3)
  assert.deepEqual(owner.receipt(before,target.read().history),{previousHead:0n,currentHead:2n,capturedPartCount:1,openingCaptured:true,terminalCaptured:true})
})
test('append promise rejection stays original and stops the suffix',async()=>{
  const owner=new TraceCapture(), target=store(), cause=Error('append unknown')
  target.append=async()=>{throw cause}
  await assert.rejects(owner.captureParts(target,[part('one'),part('two')],'stable'),error=>error===cause)
  assert.deepEqual(target.calls,['blob:one'])
})
