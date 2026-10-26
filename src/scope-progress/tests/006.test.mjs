import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteJournal } from 'wanxiangli/eventstore'
import {
  advisorClaim, advisorFinish, advisorPending, advisorStageBegin, advisorStageConfirm,
  AdvisorFlow, AdvisorProcessQueue,
} from 'wanxiangli/scope-progress'

const withDatabase = async action => {
  const directory = mkdtempSync(join(tmpdir(), 'wxs-advisor-cold-flow-'))
  const filename = join(directory, 'advisor.sqlite')
  const use = fn => {
    const journal = new SqliteJournal(new DatabaseSync(filename))
    try { return fn(journal) } finally { journal.close() }
  }
  try { await action(use) } finally { rmSync(directory, { recursive: true, force: true }) }
}
const until = async check => {
  for (let n = 0; n < 120; n++) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('cold recovery terminal was not observed')
}
const create = (use, queue, calls) => AdvisorFlow(queue, {
  CurrentEpoch: () => 'scope-1',
  LanguageFor: () => 'en',
  Pending: async (session, scope) => use(j => advisorPending(j, session, scope)),
  Claim: async (session, scope, report, issue) => use(j => advisorClaim(j, session, scope, report, issue)),
  Finish: async (session, scope, reports, result) => use(j => advisorFinish(j, session, scope, reports, result)),
  BeginStage: async (session, scope, process, phase, prompt, members) =>
    use(j => advisorStageBegin(j, session, scope, process, phase, prompt, members)),
  ConfirmStage: async (session, scope, process, phase, prose) =>
    use(j => advisorStageConfirm(j, session, scope, process, phase, prose)),
  AskWorker: async () => { calls.push('worker'); return { Ok: true, Prose: 'new worker fact', Reason: '' } },
  AskSeat: async () => { calls.push('seat'); return { Ok: true, Prose: 'advisor advice', Reason: '' } },
  SendSteer: async () => { calls.push('steer'); return { Ok: true, Prose: '', Reason: '' } },
})

test('SPEC[scope-progress-006] restart adopts a confirmed first reply and runs only the unissued remaining stages', async () => withDatabase(async use => {
  const session = 'cold-session'
  const scope = 'scope-1'
  const report = 'report-1'
  const issue = 'What blocked you?'
  const processId = AdvisorProcessQueue().enqueue(session, scope, report).processId
  assert.equal(use(j => advisorClaim(j, session, scope, report, issue)).status, 'Committed')
  assert.equal(use(j => advisorStageBegin(j, session, scope, processId, 1, issue, [report])).start, true)
  assert.equal(use(j => advisorStageConfirm(j, session, scope, processId, 1, 'earlier worker evidence')).status, 'Committed')

  const calls = []
  const recovered = create(use, AdvisorProcessQueue(), calls)
  const result = await recovered.resume(session, scope)
  assert.equal(result.start, true)
  await until(() => use(j => j.read('advisor-process:' + session).some(x => x.includes('"kind":"Finished"'))))
  assert.deepEqual(calls, ['seat', 'worker', 'seat', 'steer'],
    'the previously confirmed first worker answer cannot be charged twice')
  const events = use(j => j.read('advisor-process:' + session).map(JSON.parse))
  assert.deepEqual(events.filter(event => event.kind === 'StageBegan').map(event => event.phase), [1, 2, 3, 4, 5])
  assert.deepEqual(events.filter(event => event.kind === 'StageAnswered').map(event => event.phase), [1, 2, 3, 4, 5])
  assert.equal(events.find(event => event.kind === 'Finished').outcome, 'Completed')
  assert.equal((await create(use, AdvisorProcessQueue(), []).resume(session, scope)).start, false)
}))

test('SPEC[scope-progress-006] an uncertain second provider call blocks every resumed owner without retry', async () => withDatabase(async use => {
  const session = 'uncertain-session', scope = 'scope-1', report = 'report-2', issue = 'question'
  const processId = AdvisorProcessQueue().enqueue(session, scope, report).processId
  use(j => advisorClaim(j, session, scope, report, issue))
  use(j => advisorStageBegin(j, session, scope, processId, 1, issue, [report]))
  use(j => advisorStageConfirm(j, session, scope, processId, 1, 'confirmed first'))
  const followup = 'What background do you need to answer the following problem well?\nconfirmed first'
  use(j => advisorStageBegin(j, session, scope, processId, 2, followup, [report]))
  for (let n = 0; n < 2; n++) {
    const calls = []
    const queue = AdvisorProcessQueue()
    const receipt = await create(use, queue, calls).resume(session, scope)
    assert.equal(receipt.start, true)
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(queue.hasActive(session, scope), true, 'uncertain paid request remains fenced')
    assert.deepEqual(calls, [], 'a reserved but unanswered Provider call may not be retried')
  }
  const events = use(j => j.read('advisor-process:' + session).map(JSON.parse))
  assert.deepEqual(events.filter(item => item.kind === 'StageBegan').map(item => item.phase), [1, 2])
  assert.equal(events.filter(item => item.kind === 'Finished').length, 0)
}))

test('SPEC[scope-progress-006] a cold physical steer with unknown delivery cannot be resent', async () => withDatabase(async use => {
  const session = 'physical-unknown-session', scope = 'scope-1', report = 'report-3', issue = 'question'
  const process = AdvisorProcessQueue().enqueue(session, scope, report).processId
  use(j => advisorClaim(j, session, scope, report, issue))
  const prompts = [
    issue,
    'What background do you need to answer the following problem well?\nworker1',
    'You raised the following problem:\nworker1\nThe following background is needed to examine it:\nseat2\nProvide the relevant context, facts, and conclusions reached so far.',
    'Additional background:\nworker3\nUse the earlier problem and this background to provide your analysis and advice.',
  ]
  for (let i = 1; i <= 4; i++) {
    use(j => advisorStageBegin(j, session, scope, process, i, prompts[i-1], [report]))
    use(j => advisorStageConfirm(j, session, scope, process, i, ['worker1','seat2','worker3','seat4'][i-1]))
  }
  use(j => advisorStageBegin(j, session, scope, process, 5, 'seat4', [report]))
  const calls = []
  const flow = create(use, AdvisorProcessQueue(), calls)
  assert.equal((await flow.resume(session, scope)).start, true)
  await new Promise(resolve => setTimeout(resolve, 35))
  assert.deepEqual(calls, [], 'confirmed A-D and an uncertain physical steer cannot start another Host effect')
  assert.equal(use(j => advisorPending(j, session, scope)).pending.length, 1)
}))


test('SPEC[scope-progress-006] thrown provider transport after durable Begin leaves Unknown and is never retried', async () => withDatabase(async use => {
  const session = 'thrown-session', scope = 'scope-1', report = 'report-4', issue = 'question'
  let dispatched = 0
  const flow = AdvisorFlow(AdvisorProcessQueue(), {
    CurrentEpoch: () => scope,
    LanguageFor: () => 'en',
    Claim: async (sid, epoch, id, question) => use(j => advisorClaim(j, sid, epoch, id, question)),
    Pending: async (sid, epoch) => use(j => advisorPending(j, sid, epoch)),
    Finish: async (sid, epoch, ids, outcome) => use(j => advisorFinish(j, sid, epoch, ids, outcome)),
    BeginStage: async (sid, epoch, process, phase, prompt, members) => use(j => advisorStageBegin(j, sid, epoch, process, phase, prompt, members)),
    ConfirmStage: async (sid, epoch, process, phase, prose) => use(j => advisorStageConfirm(j, sid, epoch, process, phase, prose)),
    AskWorker: async () => { dispatched++; throw Error('provider connection failed after send') },
    AskSeat: async () => { throw Error('should not reach advisor') },
    SendSteer: async () => { throw Error('should not steer') },
  })
  assert.equal((await flow.trigger(session, scope, report, issue)).start, true)
  await until(() => dispatched === 1)
  await new Promise(resolve => setTimeout(resolve, 25))
  const original = use(j => j.read('advisor-process:' + session).map(JSON.parse))
  assert.deepEqual(original.map(e => e.kind), ['Admitted','StageBegan'])
  assert.deepEqual(original.filter(e => e.kind === 'Finished'), [])
  const restartedCalls = []
  const newFlow = create(use, AdvisorProcessQueue(), restartedCalls)
  assert.equal((await newFlow.resume(session, scope)).start, true)
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.deepEqual(restartedCalls, [])
  assert.equal(use(j => advisorPending(j, session, scope)).pending.length, 1)
}))

test('SPEC[scope-progress-006] cold resume drains multiple durably admitted reports in order without another Host turn', async () => withDatabase(async use => {
  const session = 'ordered-recovery', scope = 'scope-1'
  const reports = ['r-first', 'r-second', 'r-third']
  for (const id of reports) {
    const admitted = use(j => advisorClaim(j, session, scope, id, 'issue for ' + id))
    assert.equal(admitted.status, 'Committed')
  }
  const calls = []
  const queue = AdvisorProcessQueue()
  const flow = create(use, queue, calls)
  const receipt = await flow.resume(session, scope)
  assert.equal(receipt.start, true)
  await until(() => use(j => j.read('advisor-process:' + session).map(JSON.parse)
    .filter(e => e.kind === 'Finished').length === reports.length))
  const events = use(j => j.read('advisor-process:' + session).map(JSON.parse))
  assert.deepEqual(events.filter(e => e.kind === 'StageBegan' && e.phase === 1).map(e => e.question),
    reports.map(id => 'issue for ' + id),
    'each admitted report must receive its own identity without a new chat.params turn')
  assert.equal(calls.filter(c => c === 'worker').length, 6)
  assert.equal(calls.filter(c => c === 'seat').length, 6)
  assert.equal(calls.filter(c => c === 'steer').length, 3)
  assert.deepEqual(use(j => advisorPending(j, session, scope)).pending, [])
}))

test('SPEC[scope-progress-006] an unknown first paid stage blocks the later admitted reports', async () => withDatabase(async use => {
  const session = 'blocked-ordered-recovery', scope = 'scope-1'
  for (const id of ['first', 'waiting']) use(j => advisorClaim(j, session, scope, id, 'issue for ' + id))
  const first = AdvisorProcessQueue().enqueue(session, scope, 'first').processId
  use(j => advisorStageBegin(j, session, scope, first, 1, 'issue for first', ['first']))
  const calls = []
  const queue = AdvisorProcessQueue()
  const receipt = await create(use, queue, calls).resume(session, scope)
  assert.equal(receipt.start, true)
  await new Promise(resolve => setTimeout(resolve, 35))
  assert.equal(queue.hasActive(session, scope), true)
  assert.deepEqual(calls, [])
  assert.equal(use(j => advisorPending(j, session, scope)).pending.length, 2)
}))

test('SPEC[scope-progress-006] SDK failure reply without terminal proof must remain Unknown across restart', async () => withDatabase(async use => {
  const session = 'sdk-unknown-reply', scope = 'scope-1'
  const calls = []
  const flow = AdvisorFlow(AdvisorProcessQueue(), {
    CurrentEpoch: () => scope,
    LanguageFor: () => 'en',
    Claim: async (sid, epoch, id, question) => use(j => advisorClaim(j, sid, epoch, id, question)),
    Pending: async (sid, epoch) => use(j => advisorPending(j, sid, epoch)),
    Finish: async (sid, epoch, ids, outcome) => use(j => advisorFinish(j, sid, epoch, ids, outcome)),
    BeginStage: async (sid, epoch, process, phase, prompt, members) => use(j => advisorStageBegin(j, sid, epoch, process, phase, prompt, members)),
    ConfirmStage: async (sid, epoch, process, phase, prose) => use(j => advisorStageConfirm(j, sid, epoch, process, phase, prose)),
    AskWorker: async () => { calls.push('sent'); return { Ok: false, Prose: '', Reason: 'CapacityQueueFull / request may have been accepted' } },
    AskSeat: async () => { calls.push('seat'); return { Ok: true, Prose: 'seat', Reason: '' } },
    SendSteer: async () => { calls.push('steer'); return { Ok: true, Prose: '', Reason: '' } },
  })
  assert.equal((await flow.trigger(session, scope, 'first', 'issue')).start, true)
  await until(() => calls.length >= 1)
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.deepEqual(use(j => j.read('advisor-process:' + session).map(JSON.parse).map(e => e.kind)), ['Admitted', 'StageBegan'],
    'an unproven SDK error is not a definitive Failed terminal')
  assert.equal((await flow.trigger(session, scope, 'second', 'another issue')).start, false)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(calls, ['sent'], 'uncertain paid call cannot unlock the second consultation')
  const newCalls = []
  const ownerAfterCrash = create(use, AdvisorProcessQueue(), newCalls)
  assert.equal((await ownerAfterCrash.resume(session, scope)).start, true)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(newCalls, [], 'a recovered owner cannot replay the uncertain request')
}))

test('SPEC[scope-progress-006] cold recovery preserves exact durably frozen merged report membership', async () => withDatabase(async use => {
  const session = 'merged-cold-recovery', scope = 'scope-1'
  const ids = ['first', 'waiting-a', 'waiting-b']
  const questions = ['prior issue', 'second issue', 'third issue']
  for (let i = 0; i < ids.length; i++) {
    assert.equal(use(j => advisorClaim(j, session, scope, ids[i], questions[i])).status, 'Committed')
  }
  assert.equal(use(j => advisorFinish(j, session, scope, ['first'], 'Completed')).status, 'Committed')
  const group = ids.slice(1)
  const process = AdvisorProcessQueue().enqueue(session, scope, group[0]).processId
  assert.equal(use(j => advisorStageBegin(j, session, scope, process, 1, 'second issue\nthird issue', group)).status, 'Committed')
  assert.equal(use(j => advisorStageConfirm(j, session, scope, process, 1, 'the exact shared worker answer')).status, 'Committed')
  const calls = []
  const recovered = create(use, AdvisorProcessQueue(), calls)
  assert.equal((await recovered.resume(session, scope)).start, true)
  await until(() => use(j => j.read('advisor-process:' + session).map(JSON.parse)
    .filter(event => event.kind === 'Finished').length === 2))
  assert.deepEqual(calls, ['seat', 'worker', 'seat', 'steer'],
    'the merged process must reuse the single confirmed worker reply')
  const facts = use(j => j.read('advisor-process:' + session).map(JSON.parse))
  assert.deepEqual(facts.filter(event => event.kind === 'Finished').at(-1).reports, group)
  assert.deepEqual(use(j => advisorPending(j, session, scope)).pending, [])
}))
