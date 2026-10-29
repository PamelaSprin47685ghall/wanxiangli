// PRODUCT-RETIRED (2026-10-29): Stall / ResetDue / remainingScopeTurnsEstimate are NOT host product contracts.
// These tests keep the scope-progress *package* historical durable/advisor-queue behavior.
// New lifecycle voice: wanxiangli/scope-retention + common law «Scope». Do not re-wire todowrite schema to estimates.
import test from 'node:test'
import assert from 'node:assert/strict'
import { AdvisorFlow, AdvisorProcessQueue } from '../../../dist/scope-progress/AdvisorFlow.js'

const ok = Prose => ({Ok:true, Prose, Reason:''})
const fail = Reason => ({Ok:false, Prose:'', Reason, ConfirmedFailure:true})
const pause = ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(ready, label) {
  for(let attempts=0;attempts<70;attempts++) {
    if(ready())return
    await pause(10)
  }
  assert.fail(label)
}

test('SPEC[scope-progress-003] four physical-model ports in order, prose1 in prose3 request, one merged waiting process', async()=>{
  const q=AdvisorProcessQueue(), calls=[], steers=[]
  let releaseFirst
  const initial=new Promise(resolve=>{releaseFirst=resolve})
  let first=true
  const flow=AdvisorFlow(q,{
    Claim: async () => ({ ok: true, accepted: true }),
    Finish: async () => ({ ok: true, status: 'Committed' }),
    BeginStage: async () => ({ ok: true, start: true }),
    ConfirmStage: async () => ({ ok: true, status: 'Committed' }),
    Pending: async () => ({ ok: true, pending: [] }),
    LanguageFor:()=> 'zh-CN',
    CurrentEpoch:()=> 'e1',
    AskWorker:async (_sid,prompt)=>{
      calls.push(['worker',prompt])
      if(first){first=false;await initial}
      return ok(calls.length===1?'工件测试失败，已排查网络。':'相关错误只出现在冷启动，已确认断言无误。')
    },
    AskSeat:async (_sid,prompt)=>{
      calls.push(['seat',prompt])
      return ok(prompt.includes('还需要哪些背景材料')?'请提供失败日志和当前版本。':'先锁定版本，再复现错误。')
    },
    SendSteer:async (sid,epoch,id,text)=>{
      assert.equal(epoch,'e1')
      calls.push(['steer',text])
      steers.push({sid,id,text})
      return ok('')
    },
  })
  assert.equal((await flow.trigger('s','e1','p1','estimate 4 was unchanged')).start,true)
  const second=await flow.trigger('s','e1','p2','work grew by 2')
  const merged=await flow.trigger('s','e1','p3','work grew by 3')
  assert.equal(second.start,false)
  assert.equal(merged.processId,second.processId)
  assert.deepEqual(Array.from(merged.notes),['work grew by 2','work grew by 3'])
  releaseFirst()
  await until(()=>steers.length===2,'both actual four-phase consultations must settle')
  assert.deepEqual(calls.map(([kind])=>kind),['worker','seat','worker','seat','steer','worker','seat','worker','seat','steer'])
  assert.ok(calls[2][1].includes('工件测试失败'),'worker C must receive original prose1')
  assert.ok(calls[2][1].includes('请提供失败日志'),'worker C must receive the actual background question without disclosing its source')
  assert.ok(calls[5][1].includes('work grew by 2') && calls[5][1].includes('work grew by 3'))
  assert.equal(steers[0].text,'先锁定版本，再复现错误。','advice must be delivered verbatim without an Advisor label')
  for(const [,visibleText] of calls) {
    assert.doesNotMatch(visibleText,/Advisor|专席|临时会话|阶段|prose[1-4]|快照|四轮问答/, 'the mechanism is never part of model-visible chat')
  }
})

test('SPEC[scope-progress-003] a model failure releases queued process; stale epochs receive no steer',async()=>{
  const q=AdvisorProcessQueue(), steers=[],workerCalls=[]
  let releaseWorker
  const workerBlocked=new Promise(resolve=>{releaseWorker=resolve})
  let requests=0, epoch='before-reset'
  const flow=AdvisorFlow(q,{
    Claim: async () => ({ ok: true, accepted: true }),
    Finish: async () => ({ ok: true, status: 'Committed' }),
    BeginStage: async () => ({ ok: true, start: true }),
    ConfirmStage: async () => ({ ok: true, status: 'Committed' }),
    Pending: async () => ({ ok: true, pending: [] }),
    LanguageFor:()=> 'zh-CN',
    CurrentEpoch:()=>epoch,
    AskWorker:async (_sid,prompt)=>{
      workerCalls.push(prompt)
      requests++
      if(requests===1){await workerBlocked; return fail('real provider failed')}
      return ok('worker answer')
    },
    AskSeat:async()=>ok('advisor reply'),
    SendSteer:async (_sid,_epoch,_id,text)=>{steers.push(text);return ok('')},
  })
  await flow.trigger('s',epoch,'failing-first','one')
  await flow.trigger('s',epoch,'waiting-second','two')
  releaseWorker()
  await until(()=>steers.length===1,'second process must run after first fails without fabricating first advice')
  assert.equal(requests,3,'first failed A and the second process completed A/C')
  assert.equal(steers.length,1)
  epoch='after-reset'
  let releaseLate
  const lateBlocked=new Promise(resolve=>{releaseLate=resolve})
  const delayed=AdvisorFlow(AdvisorProcessQueue(),{
    Claim: async () => ({ ok: true, accepted: true }),
    Finish: async () => ({ ok: true, status: 'Committed' }),
    BeginStage: async () => ({ ok: true, start: true }),
    ConfirmStage: async () => ({ ok: true, status: 'Committed' }),
    Pending: async () => ({ ok: true, pending: [] }),
    LanguageFor:()=> 'zh-CN',
    CurrentEpoch:()=>epoch,
    AskWorker:async()=>{await lateBlocked;return ok('late old scope')},
    AskSeat:async()=>ok('should not arrive'),
    SendSteer:async(_sid,_epoch,_id,text)=>{steers.push(text);return ok('')},
  })
  const received=await delayed.trigger('s',epoch,'late','old')
  epoch='newer-scope'
  releaseLate()
  await pause(30)
  assert.equal(received.start,true)
  assert.equal(steers.length,1,'a late reply cannot cross a reset epoch')
})

test('SPEC[scope-progress-003] late trigger cannot evict the current scope or start an old consultation', async () => {
  const queue = AdvisorProcessQueue()
  let calls = 0
  const flow = AdvisorFlow(queue, {
    Claim: async () => ({ ok: true, accepted: true }),
    Finish: async () => ({ ok: true, status: 'Committed' }),
    BeginStage: async () => ({ ok: true, start: true }),
    ConfirmStage: async () => ({ ok: true, status: 'Committed' }),
    Pending: async () => ({ ok: true, pending: [] }),
    LanguageFor: () => 'zh-CN',
    CurrentEpoch: () => 'new-epoch',
    AskWorker: async () => { calls++; return ok('worker') },
    AskSeat: async () => { calls++; return ok('advisor') },
    SendSteer: async () => { calls++; return ok('') },
  })
  const stale = await flow.trigger('s', 'old-epoch', 'stale-report', 'stale question')
  assert.equal(stale.ok, false)
  assert.equal(calls, 0, 'a retired epoch must not make an external model call')
  const current = await flow.trigger('s', 'new-epoch', 'fresh-report', 'fresh question')
  assert.equal(current.start, true)
  await until(() => calls === 5, 'the current process still completes four stages and steer')
  const replay = await flow.trigger('s', 'new-epoch', 'fresh-report', 'fresh question')
  assert.equal(replay.start, false, 'a completed trigger cannot run twice')
  assert.equal(calls, 5)
})


test('SPEC[scope-progress-003] unrecognized session locale cannot start model requests', async () => {
  let calls = 0
  const flow = AdvisorFlow(AdvisorProcessQueue(), {
    Claim: async () => ({ ok: true, accepted: true }),
    Finish: async () => ({ ok: true, status: 'Committed' }),
    BeginStage: async () => ({ ok: true, start: true }),
    ConfirmStage: async () => ({ ok: true, status: 'Committed' }),
    Pending: async () => ({ ok: true, pending: [] }),
    LanguageFor: () => 'fr',
    CurrentEpoch: () => 'e1',
    AskWorker: async () => { calls++; return ok('worker') },
    AskSeat: async () => { calls++; return ok('seat') },
    SendSteer: async () => { calls++; return ok('') },
  })
  assert.equal((await flow.trigger('s', 'e1', 'report', 'issue')).start, true)
  await pause(15)
  assert.equal(calls, 0)
})

test('SPEC[scope-progress-003] a final steer with unknown physical landing cannot settle or release the Advisor Process', async () => {
  for (const sendMode of ['rejected', 'thrown']) {
    const queue = AdvisorProcessQueue()
    let physicalRequests = 0
    let modelRequests = 0
    let finished = 0
    const flow = AdvisorFlow(queue, {
      Claim: async () => ({ ok: true, accepted: true }),
      Finish: async () => { finished++; return { ok: true, status: 'Committed' } },
      BeginStage: async () => ({ ok: true, start: true }),
      ConfirmStage: async () => ({ ok: true, status: 'Committed' }),
      Pending: async () => ({ ok: true, pending: [] }),
      LanguageFor: () => 'en',
      CurrentEpoch: () => 'epoch',
      AskWorker: async () => { modelRequests++; return ok('worker evidence') },
      AskSeat: async () => { modelRequests++; return ok('advisor analysis') },
      SendSteer: async () => {
        physicalRequests++
        if (sendMode === 'thrown') throw Error('provider disconnect after dispatch')
        return fail('Acceptance unknown for submitted PromptKey')
      },
    })
    const receipt = await flow.trigger('s', 'epoch', 'first', 'issue')
    assert.equal(receipt.start, true)
    await until(() => physicalRequests === 1, 'the final steer must be attempted')
    await pause(15)
    assert.equal(queue.hasActive('s', 'epoch'), true, 'the uncertain physical steer must remain fenced')
    assert.equal(finished, 0, 'unknown physical delivery cannot be committed as Finished(Failed)')
    const subsequent = await flow.trigger('s', 'epoch', 'waiting', 'different issue')
    assert.equal(subsequent.start, false)
    await pause(15)
    assert.equal(modelRequests, 4, 'a pending physical landing must not permit another consultation')
    assert.equal(physicalRequests, 1, 'no repeat steer may be submitted while outcome is unknown')
  }
})
