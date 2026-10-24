import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packedPackage } from './package-metadata.mjs'
const root = fileURLToPath(new URL('../..', import.meta.url))
const {NODE_PATH, NODE_OPTIONS, ...env} = process.env
function run(cmd,args,cwd) {
 const r=spawnSync(cmd,args,{cwd,env,encoding:'utf8',timeout:60000})
 assert.ifError(r.error);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout
}
test('SPEC[build-005] clean installed program/runtime public entries work on Node and Bun with strict TypeScript', {timeout:120000}, t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'wanxiangli-program-package-'))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const pack=packedPackage(run('npm',['pack','--ignore-scripts','--json','--pack-destination',dir],root))
 for(const item of ['dist/program/Program.js','dist/runtime/Runtime.js','src/program/index.d.ts','src/runtime/index.d.ts']) assert.ok(pack.files.some(f=>f.path===item),item)
 assert.ok(!pack.files.some(f=>/\.fs(i|proj)?$/.test(f.path)), 'consumer contains no F# source')
 assert.ok(!pack.files.some(f=>/^(dist|src)\/(programming|sandbox|wait|fs|process|pty|spool|time)\//.test(f.path)), 'retired public directories are absent')
 const consumer=path.join(dir,'consumer');mkdirSync(consumer)
 writeFileSync(path.join(consumer,'package.json'),JSON.stringify({name:'program-clean-consumer',private:true,type:'module'}))
 run('npm',['install','--ignore-scripts','--omit=dev','--no-audit','--no-fund',path.join(dir,pack.filename)],consumer)
 for(const f of ['program-consumer.mjs','program-consumer.ts']) copyFileSync(path.join(root,'scripts/tests',f),path.join(consumer,f))
 assert.deepEqual(readdirSync(path.join(consumer,'node_modules')).filter(n=>!n.startsWith('.')),['wanxiangli'])
 run(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--target','es2022','--module','nodenext','program-consumer.ts'],consumer)
 for(const executable of [process.execPath,'bun']) {
   const observed=JSON.parse(run(executable,[path.join(consumer,'program-consumer.mjs')],tmpdir()).trim())
   assert.equal(observed.installed,true);assert.equal(observed.retiredEntries,true)
 }
})
