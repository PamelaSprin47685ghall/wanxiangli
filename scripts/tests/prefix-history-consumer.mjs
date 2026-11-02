import assert from 'node:assert/strict'
import { Prefix, PrefixHistory } from 'wanxiangli/prefix'
const law = new Prefix()
const initial = new PrefixHistory()
const candidate = {previousEpoch:0n,nextEpoch:1n,evidence:{kind:'scope',callId:'reset'}}
const advanced = initial.advanceScope(candidate, 'blob:scope', 'digest:scope')
assert.equal(advanced.ok, true)
const receipt = advanced.value.recordScopeQuestion(1n,'ask','questions')
assert.equal(receipt.ok, true)
assert.equal(receipt.value.scopeQuestion('ask'),'questions')
assert.equal(receipt.value.lastScopeArchive().targetEpoch,1n)
assert.equal(initial.epoch(),0n)
assert.equal(receipt.value.advanceScope(candidate,null,null).ok,false)
assert.equal(receipt.value.recordScopeQuestion(1n,'ask','other').ok,false)
assert.equal(law.empty().epoch,0)
console.log(JSON.stringify({prefixHistory:true}))
