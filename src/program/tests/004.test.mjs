import test from 'node:test';
import {assert,harness,command,WAIT,delay,deferred,file,exists,readFile,writeFile,join,alive,heldCommand,json} from './fixtures.mjs';

test('SPEC[program-004] late SDK failure during drain park survives resume',{timeout:15000},async t=>{
  const h=await harness(t),gate=deferred();let operation;
  const forbidden=command("require('node:fs').writeFileSync(process.argv[1],'started')",join(h.root,'forbidden'));
  try{
    const result=await h.run('sdk-error',"try{this.slow();return this.call("+json(forbidden)+");}finally{await this.mark('finally','ran');}",{
      slow:()=>{operation=(async()=>{await writeFile(join(h.root,'effect'),'kept');await gate.promise;throw new Error('SDK_FAILED_DURING_PARK');})();return operation;}
    },{intent:'xxxx'});
    assert.equal(result.state,'parked',json(result));assert.equal(result.reason,'sdk-drain');assert.equal(result.command.started,false);
    gate.resolve();await assert.rejects(operation,/SDK_FAILED_DURING_PARK/);
    const done=await h.resume('sdk-error',undefined,WAIT);
    assert.equal(done.state,'failed',json(done));assert.match(json(done),/SDK_FAILED_DURING_PARK/);
    assert.equal(await readFile(join(h.root,'effect'),'utf8'),'kept');
    assert.equal(await readFile(join(h.root,'finally'),'utf8'),'ran');
    assert.equal(await exists(join(h.root,'forbidden')),false);
  }finally{gate.resolve();}
});

test('SPEC[program-004] abandon permits an authorized cleanup call in finally',{timeout:15000},async t=>{
  const h=await harness(t),cmd=heldCommand(h.root,'cleanup','cleaned');
  const body="try{this.park('hold');}finally{const r=this.call("+json(cmd)+");await this.mark('recorded',String(r.exitCode));}";
  assert.equal((await h.run('cleanup',body)).state,'parked');
  const pending=h.control("return this.abandon('cleanup');");
  try{
    const first=await Promise.race([file(join(h.root,'cleanup-started')).then(()=>'started'),pending.then(()=>'returned')]);
    assert.equal(first,'started');
    await writeFile(join(h.root,'cleanup-release'),'release');
    const done=await pending;
    assert.equal(done.state,'abandoned',json(done));assert.equal(done.forced,false);
    assert.equal(await readFile(join(h.root,'recorded'),'utf8'),'0');
    assert.deepEqual(await h.resume('cleanup',undefined,WAIT),done);
  }finally{await writeFile(join(h.root,'cleanup-release'),'release');}
});

test('SPEC[program-004] program code cannot manufacture a call budget',{timeout:15000},async t=>{
  const h=await harness(t);
  const cmd=command("require('node:fs').writeFileSync(process.argv[1],'started')",join(h.root,'bypass'));
  const r=await h.run('bypass',"const intent='x'.repeat(48000);return this.call("+json(cmd)+",intent);",{}, {intent:'xxxx'});
  assert.equal(r.state,'failed',json(r));assert.equal(r.code,'CALL_COMMAND_UNSUPPORTED');
  assert.equal(await exists(join(h.root,'bypass')),false);
});

test('SPEC[program-004] read-only controls cannot borrow target Exec',{timeout:15000},async t=>{
  const h=await harness(t);
  const cmd=command("const fs=require('node:fs');const publish=(path,text)=>{fs.writeFileSync(path+'.pending',text);fs.renameSync(path+'.pending',path);};let received='';process.stdin.setEncoding('utf8');process.stdin.on('data',text=>{received+=text;if(received.includes('still-alive\\n'))publish(process.argv[2],received);});publish(process.argv[1],String(process.pid));setInterval(()=>{},1000);",join(h.root,'pid'),join(h.root,'input'));
  assert.equal((await h.run('owned',"return this.call("+json(cmd)+");",{}, {intent:'xxxx'})).state,'parked');await file(join(h.root,'pid'));
  for(const [name,body]of [['read-signal',"return this.signal('owned','SIGTERM');"],['read-send',"return this.send('owned','forbidden');"]]){
    const denied=await h.run(name,body,{}, {capabilities:['Read']});assert.equal(denied.state,'failed',json(denied));
  }
  await h.control("return this.send('owned','still-alive');");await file(join(h.root,'input'));
  assert.equal(await readFile(join(h.root,'input'),'utf8'),'still-alive\n');
  assert.equal(alive(Number(await readFile(join(h.root,'pid'),'utf8'))),true);
});

test('SPEC[program-004] physical call replay retains original receipt after progress',{timeout:15000},async t=>{
  const h=await harness(t),body="const first=this.park('first');const second=this.park('second');return {first,second};",options={callId:'original-call'};
  const original=structuredClone(await h.run('history',body,{},options));
  assert.equal(original.state,'parked');assert.equal(original.payload,'first');
  assert.deepEqual(await h.run('history',body,{},options),original);
  const next=await h.resume('history','one',WAIT);assert.equal(next.state,'parked');assert.equal(next.payload,'second');
  assert.deepEqual(await h.run('history',body,{},options),original);
  const done=structuredClone(await h.resume('history','two',WAIT));
  assert.equal(done.state,'completed');assert.deepEqual(done.value,{first:'one',second:'two'});
  assert.deepEqual(await h.run('history',body,{},options),original);assert.deepEqual(await h.resume('history',undefined,WAIT),done);
});

test('SPEC[program-004] receipts await lifecycle persistence and report a failed audit without erasing the pause', {timeout:15000}, async t=>{
  const h=await harness(t), gate=deferred(), entered=deferred(), events=[];
  const pending=h.run('audit',"const answer=this.park('retained'); return answer;",{}, {
    lifecycle: async event => {
      events.push(event.event);
      if(event.event==='parked') {
        entered.resolve(); await gate.promise;
        throw Object.assign(new Error('audit unavailable'),{code:'AUDIT_TEST_FAILURE'});
      }
    }
  });
  try {
    await entered.promise;
    let published=false;pending.then(()=>{published=true;});
    await delay(20);assert.equal(published,false);
    gate.resolve();
    const parked=await pending;
    assert.equal(parked.state,'parked');assert.equal(parked.payload,'retained');
    assert.equal(parked.lifecycleError.code,'AUDIT_TEST_FAILURE');
    const resumed=await h.resume('audit','answer',WAIT);
    assert.equal(resumed.state,'completed');assert.equal(resumed.value,'answer');
    assert.equal(resumed.lifecycleError.code,'AUDIT_TEST_FAILURE');
    assert.deepEqual(events.filter(e=>['parked','unparked','completed'].includes(e)),['parked','unparked','completed']);
  } finally { gate.resolve(); }
});
