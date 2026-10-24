import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Runtime } from '../../../dist/runtime/Runtime.js'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'"
function fact(pid) {
  let text
  try { text = readFileSync('/proc/'+pid+'/stat','utf8') }
  catch(error) { if (['ENOENT','ESRCH'].includes(error.code)) return; throw error }
  const end = text.lastIndexOf(')')
  if (end < 0) throw new Error('Malformed process state')
  const fields = text.slice(end+1).trim().split(/\s+/), group = Number(fields[2])
  if (!fields[0] || !Number.isSafeInteger(group)) throw new Error('Incomplete process state')
  return { pid:Number(pid), group, state:fields[0] }
}
const live = item => item !== undefined && !['Z','X','x'].includes(item.state)
const running = pid => live(fact(pid))
function members(group) {
  return readdirSync('/proc').filter(name => /^\d+$/.test(name)).map(name => fact(Number(name))).filter(item => item && item.group === group && live(item)).map(item => item.pid)
}
async function until(predicate, reason) {
  const deadline = Date.now()+3000
  while(!predicate()) { assert.ok(Date.now()<deadline,reason); await delay(10) }
}
async function orphan(t,{ignoreTerm=false,lifetime=4000}={}) {
  const root = mkdtempSync(join(tmpdir(),'runtime-group-')), pidFile=join(root,'child.pid'), activity=join(root,'activity.txt')
  const childSource = `const fs=require('node:fs'); const activity=${JSON.stringify(activity)};
    ${ignoreTerm ? "process.on('SIGTERM',()=>fs.appendFileSync(activity,'term\\n'));" : ''}
    fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); fs.writeFileSync(activity,'ready\\n');
    const ticker=setInterval(()=>fs.appendFileSync(activity,'tick\\n'),20);
    setTimeout(()=>{clearInterval(ticker);fs.appendFileSync(activity,'finished\\n');process.exit(0)},${lifetime});`
  const parentSource = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childSource)}],{detached:false,stdio:'ignore'});process.stdout.write('shell child admitted\\n');process.exit(0);`
  const call=Runtime().startCommand({root,outputRoot:root,command:quote(process.execPath)+' -e '+quote(parentSource)})
  let settled=false,childPid
  call.result.then(()=>{settled=true},()=>{settled=true})
  t.after(async()=>{
    if(childPid) try {
      const commandLine=readFileSync('/proc/'+childPid+'/cmdline','utf8')
      if(commandLine.includes(root)&&running(childPid)) process.kill(childPid,'SIGKILL')
    } catch(error) { if(!['ENOENT','ESRCH'].includes(error.code))throw error }
    try {await call.close()} catch(_){}
    rmSync(root,{recursive:true,force:true})
  })
  await until(()=>{
    let text
    try{text=readFileSync(pidFile,'utf8').trim()}catch(error){if(error.code==='ENOENT')return false;throw error}
    if(!/^\d+$/.test(text))return false
    const value=Number(text); if(!Number.isSafeInteger(value)||value<=0)return false
    childPid=value;return true
  },'child must report PID')
  await until(()=>!running(call.pid),'shell must exit')
  await until(()=>existsSync(activity),'child must start writing')
  return {call,childPid,activity,settled:()=>settled}
}
test('Runtime: surviving group keeps command active after shell exits',{timeout:7000,skip:process.platform!=='linux'},async t=>{
  const run=await orphan(t,{lifetime:1000})
  assert.equal(running(run.childPid),true)
  const first=readFileSync(run.activity,'utf8')
  await delay(80)
  assert.ok(readFileSync(run.activity,'utf8').length>first.length)
  assert.equal(run.settled(),false)
  const result=await run.call.result
  assert.equal(result.exitCode,0);assert.equal(result.signal,null)
  assert.ok(readFileSync(run.activity,'utf8').endsWith('finished\n'))
  assert.equal(running(run.childPid),false);assert.deepEqual(members(run.call.pid),[])
})
test('Runtime: close reaps surviving group after shell close',{timeout:7000,skip:process.platform!=='linux'},async t=>{
  const run=await orphan(t)
  assert.equal(running(run.childPid),true);assert.equal(run.settled(),false)
  const closed=await run.call.close()
  assert.equal(closed.forced,false);assert.equal(running(run.childPid),false);assert.deepEqual(members(run.call.pid),[])
  const text=readFileSync(run.activity,'utf8')
  assert.equal(text.includes('finished\n'),false);await delay(60);assert.equal(readFileSync(run.activity,'utf8'),text)
  const result=await run.call.result
  assert.equal(result.exitCode,0);assert.equal(result.signal,null)
  assert.equal((await run.call.signal('SIGTERM')).sent,false)
})
test('Runtime: surviving SIGTERM-resistant child requires confirmed force cleanup',{timeout:7000,skip:process.platform!=='linux'},async t=>{
  const run=await orphan(t,{ignoreTerm:true}),closed=await run.call.close()
  assert.equal(closed.forced,true);assert.equal(running(run.childPid),false);assert.deepEqual(members(run.call.pid),[])
  const text=readFileSync(run.activity,'utf8');assert.match(text,/term\n/);assert.equal(text.includes('finished\n'),false)
  const result=await run.call.result;assert.equal(result.exitCode,0);assert.equal(result.signal,null)
})
