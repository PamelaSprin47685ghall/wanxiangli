import test from 'node:test';
import {assert,readFile,writeFile,join,delay,WAIT,json,command,deferred,exists,file,harness,heldCommand} from './fixtures.mjs';

test('SPEC 2: call drains an unawaited SDK operation before command start',{timeout:15000},async t=>{
 const h=await harness(t),entered=deferred(),release=deferred();
 const sdk=join(h.root,'sdk'),done=join(h.root,'command');
 const cmd=command("const fs=require('node:fs');if(!fs.existsSync(process.argv[1]))process.exit(97);fs.writeFileSync(process.argv[2],'done');",sdk,done);
 const running=h.run('drain','this.slow();const r=this.call('+json(cmd)+');await this.mark("continued","yes");return r;',
 {slow:async()=>{entered.resolve();await release.promise;await writeFile(sdk,'saved');return 'saved';}});
 try{await entered.promise;assert.equal(await exists(done),false);release.resolve();const r=await running;
 assert.equal(r.state,'completed',json(r));assert.equal(r.value.exitCode,0);assert.equal(await readFile(join(h.root,'continued'),'utf8'),'yes');
 }finally{release.resolve();}
});
test('SPEC 2: expired drain never starts until unpark',{timeout:15000},async t=>{
 const h=await harness(t),release=deferred(),sdk=join(h.root,'sdk'),starts=join(h.root,'starts');
 const cmd=command("require('node:fs').appendFileSync(process.argv[1],'start\\n');",starts);
 try{const p=await h.run('drain','this.slow();const r=this.call('+json(cmd)+');await this.mark("continued","yes");return r;',
 {slow:async()=>{await release.promise;await writeFile(sdk,'saved');return 'saved';}}, {intent:'xxxx'});
 assert.equal(p.state,'parked',json(p));assert.equal(p.reason,'sdk-drain');assert.equal(p.command.started,false);assert.ok(p.pendingOperations>0);
 release.resolve();await file(sdk);assert.equal(await exists(starts),false);assert.equal(await exists(join(h.root,'continued')),false);
 const r=await h.resume('drain');assert.equal(r.state,'completed',json(r));assert.equal(r.value.exitCode,0);assert.equal(await readFile(starts,'utf8'),'start\n');
 }finally{release.resolve();}
});
for(const form of ['unawaited','Promise.all'])test('SPEC 2: '+form+' cannot pass first call',{timeout:15000},async t=>{
 const h=await harness(t),first=heldCommand(h.root,'first');
 const second=command("const fs=require('node:fs');if(!fs.existsSync(process.argv[1]))process.exit(98);fs.writeFileSync(process.argv[2],'second');",join(h.root,'first-ended'),join(h.root,'second-started'));
 const calls=['this.call('+json(first)+')','this.call('+json(second)+')'];
 const body=form==='unawaited'?calls.join(';')+';':'await Promise.all(['+calls.join(',')+']);';
 const p=await h.run('serial',body+'await this.mark("continued","yes");return "done";',{}, {intent:'xxxx'});
 assert.equal(p.state,'parked',json(p));await file(join(h.root,'first-started'));
 assert.equal(await exists(join(h.root,'second-started')),false);assert.equal(await exists(join(h.root,'continued')),false);
 await writeFile(join(h.root,'first-release'),'go');await file(join(h.root,'first-ended'));
 assert.equal(await exists(join(h.root,'second-started')),false);
 const r=await h.resume('serial');assert.equal(r.state,'completed',json(r));assert.equal(r.value,'done');
 assert.equal(await readFile(join(h.root,'second-started'),'utf8'),'second');
});
test('SPEC 2: exit after park preserves continuation and true call result',{timeout:15000},async t=>{
 const h=await harness(t);const p=await h.run('call','const r=this.call('+json(heldCommand(h.root,'call','real-output'))+');await this.mark("continued","yes");return r;',{}, {intent:'xxxx'});
 assert.equal(p.state,'parked',json(p));await file(join(h.root,'call-started'));await writeFile(join(h.root,'call-release'),'go');await file(join(h.root,'call-ended'));
 assert.equal(await exists(join(h.root,'continued')),false);
 const r=await h.resume('call',{exitCode:99,stdout:'fake'});assert.equal(r.state,'completed',json(r));assert.equal(r.value.exitCode,0);assert.equal(r.value.stdout,'real-output');
 assert.deepEqual(await h.resume('call','ignored'),r);
});
test('SPEC 2: only explicit park receives the injected value',{timeout:15000},async t=>{
 const h=await harness(t),payload={question:'choose',choices:['a','b']},value={answer:'b'};
 const p=await h.run('choice','return {answer:this.park('+json(payload)+')};');assert.equal(p.state,'parked',json(p));assert.deepEqual(p.payload,payload);
 const r=await h.resume('choice',value);assert.equal(r.state,'completed',json(r));assert.deepEqual(r.value,{answer:value});
});
test('SPEC 2: retry replays; an ended name is reusable while a parked name stays taken',{timeout:15000},async t=>{
 const h=await harness(t),starts=join(h.root,'starts'),cmd=command("require('node:fs').appendFileSync(process.argv[1],'start\\n');",starts);
 const body='return this.call('+json(cmd)+');';
 const first=await h.run('once',body,{}, {callId:'original'});assert.equal(first.state,'completed',json(first));assert.equal(first.value.exitCode,0);
 assert.deepEqual(await h.run('once',body,{}, {callId:'original'}),first);
 assert.equal(await readFile(starts,'utf8'),'start\n');
 const second=await h.run('once',body,{}, {callId:'later'});assert.equal(second.state,'completed',json(second));assert.equal(second.value.exitCode,0);
 assert.equal(await readFile(starts,'utf8'),'start\nstart\n');assert.deepEqual(await h.resume('once'),second);
 assert.equal((await h.run('held','await this.park({ready:true});return 1;')).state,'parked');
 assert.equal((await h.run('held','return 2;')).code,'NAME_TAKEN');
});
test('SPEC 2: a control program observed before name reuse cannot resume the new run',{timeout:15000},async t=>{
 const h=await harness(t);
 assert.equal((await h.run('target','const value=await this.park({round:1});return value;')).state,'parked');
 await h.run('hold','const value=this.park({waiting:true});return this.unpark("target",value);');
 assert.equal((await h.control('return this.abandon("target");')).state,'abandoned');
 const fresh=await h.run('target','const value=await this.park({round:2});return value;');
 assert.equal(fresh.state,'parked',json(fresh));assert.deepEqual(fresh.payload,{round:2});
 const late=await h.resume('hold','go');assert.equal(late.value.code,'STALE_CONTROL',json(late));
 assert.equal(h.session.pendingNames().includes('target'),true);
 assert.equal((await h.resume('target','second')).value,'second');
});
test('SPEC 2: old control cannot consume a later pause',{timeout:15000},async t=>{
 const h=await harness(t);
 assert.equal((await h.run('target','const first=this.park("first");const second=this.park("second");await this.mark("ended","yes");return {first,second};')).state,'parked');
 await h.run('old','this.park("hold");return this.unpark("target","stale");');
 const second=await h.resume('target','first-value');assert.equal(second.payload,'second');
 const late=await h.resume('old','release');assert.equal(late.value.code,'STALE_CONTROL',json(late));assert.equal(await exists(join(h.root,'ended')),false);
 const r=await h.resume('target','second-value');assert.deepEqual(r.value,{first:'first-value',second:'second-value'});
});
test('SPEC 2: old signal cannot hit the next command',{timeout:15000},async t=>{
 const h=await harness(t);await h.run('target','const first=this.call('+json(heldCommand(h.root,'first','first'))+');const second=this.call('+json(heldCommand(h.root,'second','second'))+');return {first,second};',{}, {intent:'xxxx'});
 await file(join(h.root,'first-started'));await h.run('old','this.park("hold");return this.signal("target","SIGTERM");');
 await writeFile(join(h.root,'first-release'),'go');await file(join(h.root,'first-ended'));
 const p=await h.resume('target',undefined,'xxxx');assert.equal(p.state,'parked',json(p));await file(join(h.root,'second-started'));
 const late=await h.resume('old');assert.equal(late.value.code,'STALE_CONTROL',json(late));
 await writeFile(join(h.root,'second-release'),'go');await file(join(h.root,'second-ended'));
 const r=await h.resume('target');assert.equal(r.value.first.exitCode,0);assert.equal(r.value.second.exitCode,0);
});
test('SPEC 2: blocked programs preserve CPU budget and other programs respond',{timeout:20000},async t=>{
 const h=await harness(t);await h.run('a','return this.call('+json(heldCommand(h.root,'a','a'))+');',{}, {intent:'xxxx'});await file(join(h.root,'a-started'));
 const running=h.run('b','return this.call('+json(heldCommand(h.root,'b','b'))+');');await file(join(h.root,'b-started'));
 const healthy=await h.run('reader','await this.mark("reader","yes");return "responsive";');assert.equal(healthy.value,'responsive',json(healthy));
 await delay(1200);await writeFile(join(h.root,'b-release'),'go');assert.equal((await running).value.exitCode,0);
 await writeFile(join(h.root,'a-release'),'go');await file(join(h.root,'a-ended'));assert.equal((await h.resume('a')).value.exitCode,0);
});
