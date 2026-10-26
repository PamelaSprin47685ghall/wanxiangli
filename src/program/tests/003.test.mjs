import test from 'node:test';
import {assert,readFile,writeFile,join,delay,WAIT,json,command,deferred,exists,file,until,alive,harness,runningCommand} from './fixtures.mjs';

test('SPEC 3: signal and stdin do not resume the target',{timeout:15000},async t=>{
 const h=await harness(t);
 const cmd=command("const fs=require('node:fs');const [pid,signaled,input]=process.argv.slice(1);let received='';process.on('SIGUSR2',()=>fs.writeFileSync(signaled,'yes'));process.stdin.setEncoding('utf8');process.stdin.on('data',text=>{received+=text;if(!received.includes('quit\\n'))return;fs.writeFileSync(input,received);process.stdout.write('accepted:'+received,()=>process.exit(7));});fs.writeFileSync(pid,String(process.pid));setInterval(()=>{},1000);",join(h.root,'pid'),join(h.root,'signal'),join(h.root,'input'));
 const p=await h.run('server','const r=this.call('+json(cmd)+');await this.mark("continued","yes");return r;',{}, {intent:'xxxx'});
 assert.equal(p.state,'parked',json(p));await file(join(h.root,'pid'));const pid=Number(await readFile(join(h.root,'pid'),'utf8'));
 const sent=await h.control('return this.signal("server","SIGUSR2");');assert.equal(sent.sent,true);await file(join(h.root,'signal'));assert.equal(alive(pid),true);
 assert.equal(await exists(join(h.root,'continued')),false);
 const input=await h.control('return this.send("server","hello\\nquit");');assert.equal(input.sent,true);
 await file(join(h.root,'input'));await until(()=>!alive(pid),'command did not exit');
 assert.equal(await readFile(join(h.root,'input'),'utf8'),'hello\nquit\n');assert.equal(await exists(join(h.root,'continued')),false);
 const r=await h.resume('server');assert.equal(r.value.exitCode,7);assert.equal(r.value.stdout,'accepted:hello\nquit\n');
});
test('SPEC 3: signal exit keeps a null code and actual signal',{timeout:15000},async t=>{
 const h=await harness(t);await h.run('signaled','return this.call('+json(runningCommand(h.root,'signal'))+');',{}, {intent:'xxxx'});
 await file(join(h.root,'signal-pid'));const pid=Number(await readFile(join(h.root,'signal-pid'),'utf8'));
 await h.control('return this.signal("signaled","SIGTERM");');await until(()=>!alive(pid),'SIGTERM did not stop command');
 const r=await h.resume('signaled');assert.equal(r.value.exitCode,null);assert.equal(r.value.signal,'SIGTERM');
});
test('SPEC 3: abandon runs native finally and confirms termination',{timeout:15000},async t=>{
 const h=await harness(t);await h.run('cancel','try {return this.call('+json(runningCommand(h.root,'cancel'))+');}finally{await this.mark("finally","ran");}',{}, {intent:'xxxx'});
 await file(join(h.root,'cancel-pid'));const pid=Number(await readFile(join(h.root,'cancel-pid'),'utf8'));
 const r=await h.control('return this.abandon("cancel");');assert.equal(r.state,'abandoned',json(r));assert.equal(r.forced,false);assert.equal(alive(pid),false);
 assert.equal(await readFile(join(h.root,'finally'),'utf8'),'ran');assert.deepEqual(await h.resume('cancel'),r);
});
test('SPEC 3: close shares command and explicit pause cleanup',{timeout:15000},async t=>{
 const h=await harness(t);await h.run('command','try {return this.call('+json(runningCommand(h.root,'close'))+');}finally{await this.mark("command-finally","ran");}',{}, {intent:'xxxx'});
 await h.run('explicit','try{return this.park("wait");}finally{await this.mark("explicit-finally","ran");}');
 await file(join(h.root,'close-pid'));const pid=Number(await readFile(join(h.root,'close-pid'),'utf8'));
 const closed=await h.session.close();assert.equal(closed.state,'closed',json(closed));assert.equal(alive(pid),false);
 assert.equal(await readFile(join(h.root,'command-finally'),'utf8'),'ran');assert.equal(await readFile(join(h.root,'explicit-finally'),'utf8'),'ran');
 assert.deepEqual(h.session.pendingNames(),[]);
});
test('SPEC 3: SDK failure is visible, earlier effects stay, command never starts',{timeout:15000},async t=>{
 const h=await harness(t),cmd=command("require('node:fs').writeFileSync(process.argv[1],'started');",join(h.root,'started'));
 const r=await h.run('sdk-failed','this.slow();return this.call('+json(cmd)+');',{slow:async()=>{await writeFile(join(h.root,'effect'),'written');throw new Error('SDK_WRITE_REJECTED');}});
 assert.equal(r.state,'failed',json(r));assert.match(json(r),/SDK_WRITE_REJECTED/);assert.equal(await readFile(join(h.root,'effect'),'utf8'),'written');
 assert.equal(await exists(join(h.root,'started')),false);
});
test('SPEC 3: infinite computation after await fails only its program',{timeout:10000},async t=>{
 const h=await harness(t),running=h.run('runaway','await this.mark("entered","yes");while(true){}',{}, {executionBudgetMs:100});
 await file(join(h.root,'entered'));const healthy=await h.run('healthy','return "responsive";');assert.equal(healthy.value,'responsive',json(healthy));
 const r=await running;assert.equal(r.state,'failed',json(r));assert.equal(r.code,'PROGRAM_EXECUTION_LIMIT');assert.equal(r.forced,true);
});
test('SPEC 3: UTF-8 bytes price the drain window',{timeout:10000},async t=>{
 const h=await harness(t),times=[],cmd=command("require('node:fs').writeFileSync(process.argv[1],'started');",join(h.root,'started'));
 for(const [name,plan] of [['utf8','中'.repeat(4)],['ascii','x'.repeat(12)]]){
  const release=deferred();let started;
  try{started=performance.now();const p=await h.run(name,'this.slow();return this.call('+json(cmd)+');',{slow:()=>release.promise},{intent:plan});
   const elapsed=performance.now()-started,budget=Buffer.byteLength(plan)*50;times.push(elapsed);
   assert.equal(p.reason,'sdk-drain',json(p));assert.equal(p.command.started,false);
   assert.ok(elapsed>=budget-60 && elapsed<budget+350,'elapsed '+elapsed+' budget '+budget);assert.equal(await exists(join(h.root,'started')),false);
  }finally{release.resolve('settled');}
 }
 assert.ok(Math.abs(times[0]-times[1])<300,json(times));
});
test('SPEC 3: resume deadline spans subsequent calls',{timeout:15000},async t=>{
 const h=await harness(t);
 const cmd=name=>command("const fs=require('node:fs');const [start,end,out]=process.argv.slice(1);fs.writeFileSync(start,'yes');setTimeout(()=>{fs.writeFileSync(end,'yes');process.stdout.write(out);},1200);",join(h.root,name+'-started'),join(h.root,name+'-ended'),name);
 await h.run('chain','this.park("ready");const first=this.call('+json(cmd('first'))+');const second=this.call('+json(cmd('second'))+');await this.mark("continued","yes");return {first,second};');
 const start=performance.now(),p=await h.resume('chain',undefined,'x'.repeat(40));
 assert.equal(p.state,'parked',json(p));assert.ok(performance.now()-start>=1900);assert.equal(await exists(join(h.root,'first-ended')),true);
 assert.equal(await exists(join(h.root,'second-started')),true);assert.equal(await exists(join(h.root,'second-ended')),false);
 await file(join(h.root,'second-ended'));assert.equal(await exists(join(h.root,'continued')),false);
 const r=await h.resume('chain');assert.equal(r.value.first.exitCode,0);assert.equal(r.value.second.exitCode,0);assert.equal(r.value.second.stdout,'second');
});
