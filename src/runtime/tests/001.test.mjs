import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Runtime} from '../../../dist/runtime/Runtime.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const baseClass='class JsProgram { constructor(api){this._api=api;} async call(a,b){return await this._api.call(a,b);} async slow(v){return await this._api.slow(v);} write(v){return this._api.write(v);} }';
function launch(program,receive,budget=500){
 let unit,finish;const terminal=new Promise(resolve=>{finish=resolve;});
 unit=Runtime().startUnit({program,baseClass,members:['call','slow','write'],executionBudgetMs:budget,outputBoundBytes:1048576},message=>{
  if(['completed','failed'].includes(message.type))finish(message);
  else if(message.type==='request')receive(message,(id,value)=>unit.reply(id,{ok:true,value}));
 });
 return {unit,terminal};
}
async function until(check){const end=Date.now()+3000;while(!check()){assert.ok(Date.now()<end,'bridge did not arrive');await delay(5);}}
test('SPEC 1: async base method still blocks two calls without await',{timeout:5000},async()=>{
 const seen=[];let first;
 const run=launch('class Js extends JsProgram { async run(){const p=Promise.all([this.call("one","wait"),this.call("two","wait")]);this.write("after");return await p;} }',(m,reply)=>{
  seen.push(m.member+':'+m.args[0]);if(m.member==='call'&&m.args[0]==='one')first=()=>reply(m.id,1);else reply(m.id,m.member==='call'?2:true);
 });
 try{await until(()=>first);await delay(80);assert.deepEqual(seen,['call:one']);first();
 const r=await run.terminal;assert.equal(r.type,'completed');assert.deepEqual(r.value,[1,2]);assert.deepEqual(seen,['call:one','call:two','write:after']);
 assert.notEqual(run.unit.pid,process.pid);assert.equal((await run.unit.exited).exitCode,0);
 }finally{await run.unit.stop('test cleanup');}
});
test('SPEC 1: host SDK completion proceeds while VM blocks',{timeout:5000},async()=>{
 const facts=[];let slow,call;
 const run=launch('class Js extends JsProgram {async run(){const p=this.slow();this.call("wait","wait");this.write("after");return await p;}}',(m,reply)=>{
  if(m.member==='slow')slow=()=>{facts.push('sdk');reply(m.id,'saved');};
  else if(m.member==='call')call=()=>{facts.push('command');reply(m.id,0);};
  else {facts.push('after');reply(m.id,true);}
 });
 try{await until(()=>slow&&call);slow();await delay(80);assert.deepEqual(facts,['sdk']);call();assert.equal((await run.terminal).value,'saved');assert.deepEqual(facts,['sdk','command','after']);}
 finally{await run.unit.stop('test cleanup');}
});
test('SPEC 1: waiting pauses CPU charge and other process responds',{timeout:5000},async()=>{
 let request;
 const a=launch('class Js extends JsProgram {async run(){return await this.call("wait","wait");}}',m=>{request=m;},80);
 try{await until(()=>request);await delay(200);const b=launch('class Js extends JsProgram {async run(){return 42;}}',()=>{});
 assert.notEqual(a.unit.pid,b.unit.pid);assert.equal((await b.terminal).value,42);await b.unit.exited;
 a.unit.reply(request.id,{ok:true,value:7});assert.equal((await a.terminal).value,7);
 }finally{await a.unit.stop('cleanup');}
});
test('SPEC 1: computation after await is killed externally',{timeout:5000},async()=>{
 const r=launch('class Js extends JsProgram {async run(){await this.slow();for(;;){}}}',(m,reply)=>setTimeout(()=>reply(m.id,true),40),100);
 assert.equal((await r.terminal).code,'PROGRAM_EXECUTION_LIMIT');assert.equal((await r.unit.exited).forced,true);
});
test('SPEC 1: SIGSTOP holds code until SIGCONT',{timeout:5000},async()=>{
 let request,wrote=false;
 const r=launch('class Js extends JsProgram {async run(){await this.call("wait","wait");this.write("after");return true;}}',(m,reply)=>{
  if(m.member==='call')request=m;else{wrote=true;reply(m.id,true);}
 });
 try{await until(()=>request);r.unit.pause();r.unit.reply(request.id,{ok:true,value:0});await delay(80);assert.equal(wrote,false);r.unit.resume();assert.equal((await r.terminal).type,'completed');assert.equal(wrote,true);}
 finally{await r.unit.stop('cleanup');}
});
test('SPEC 1: cancellation runs reachable native finally',{timeout:5000},async()=>{
 let request,cleaned=false;
 const r=launch('class Js extends JsProgram {async run(){try{await this.call("wait","wait");}finally{this.write("cleanup");}}}',(m,reply)=>{
  if(m.member==='call')request=m;else{cleaned=true;reply(m.id,true);}
 });
 await until(()=>request);r.unit.pause();const exit=await r.unit.stop('cancel');assert.equal(exit.forced,false);assert.equal(cleaned,true);assert.equal((await r.terminal).type,'failed');
});
test('SPEC 1: members and SDK results do not expose the host realm',{timeout:5000},async()=>{
 const r=launch('class Js extends JsProgram {async run(){let blocked=false;try{this._api.write.constructor("return process")();}catch(_){blocked=true;}const v=await this.slow();let resultBlocked=false;try{v.constructor.constructor("return process")();}catch(_){resultBlocked=true;}return {blocked,resultBlocked,processType:typeof process,requireType:typeof require};}}',(m,reply)=>reply(m.id,{}));
 assert.deepEqual((await r.terminal).value,{blocked:true,resultBlocked:true,processType:'undefined',requireType:'undefined'});await r.unit.exited;
});

test('SPEC 1: a compiled Bun host starts a worker instead of re-executing itself',{timeout:20000},t=>{
 const bun=spawnSync('bun',['--version'],{encoding:'utf8'});
 if(bun.status!==0)return t.skip('Bun CLI is unavailable');
 const root=mkdtempSync(join(tmpdir(),'runtime-compiled-host-'));
 try{
  const entry=join(root,'host.mjs'),executable=join(root,'host');
  writeFileSync(entry,[
   "import { Runtime } from "+JSON.stringify(fileURLToPath(new URL('../../../dist/runtime/Runtime.js',import.meta.url)))+";",
   "if(process.argv.includes('--eval')) { console.error('compiled host is not a JavaScript interpreter'); process.exit(7); }",
   "const messages=[];",
   "let unit;",
   "try { unit=Runtime().startUnit({program:'class Js extends JsProgram { async run() { return 42; } }',baseClass:'class JsProgram {}',members:[],executionBudgetMs:1000},message=>messages.push(message)); }",
   "catch(error) { console.log(JSON.stringify({error:{code:error.code,reason:error.message}})); process.exit(0); }",
   "const exit=await unit.exited;",
   "console.log(JSON.stringify({messages,exit}));"
  ].join('\n')+'\n');
  const built=spawnSync('bun',['build','--compile',entry,'--outfile',executable],{encoding:'utf8'});
  assert.equal(built.status,0,built.stderr);
  const run=spawnSync(executable,[],{encoding:'utf8',timeout:5000});
  assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(run.stdout.trim());
  assert.deepEqual(result.messages,[{type:'completed',value:42}]);
  assert.equal(result.exit.exitCode,0);
  const nodeOnly=spawnSync(executable,[],{encoding:'utf8',timeout:5000,env:{...process.env,PATH:dirname(process.execPath)}});
  assert.equal(nodeOnly.status,0,nodeOnly.stderr);
  assert.deepEqual(JSON.parse(nodeOnly.stdout.trim()).messages,[{type:'completed',value:42}]);
  const noInterpreter=spawnSync(executable,[],{encoding:'utf8',timeout:5000,env:{PATH:''}});
  assert.equal(noInterpreter.status,0,noInterpreter.stderr);
  assert.equal(JSON.parse(noInterpreter.stdout.trim()).error.code,'PROGRAM_RUNTIME_UNAVAILABLE');
 }finally{rmSync(root,{recursive:true,force:true});}
});
