import test from 'node:test'
import assert from 'node:assert/strict'
import { ChildRunSet } from 'wanxiangli/handle-lifecycle'
import { Wait } from 'wanxiangli/program'

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return {promise, resolve, reject} }
const completed = view => ({kind: 'completed', view, childSessionId: 'child', authorityRoot: 'root', providerRun: 'provider', directory: null})
const input = (run, extra = {}) => ({agentId: 'a', agent: ' coder ', role: 'engineer', run, ...extra})
const fixture = (extra = {}) => {
  let serial = 0
  const mailbox = Wait.completionMailbox()
  const set = new ChildRunSet({mailbox, now: () => new Date(0), mintRunId: () => `run-${++serial}`,
    raceExit: async pending => { await pending; return true }, runDefault: async () => completed('default'), ...extra})
  return {set, mailbox}
}

test('busy run keeps its original work; idle replacement keeps old waits attached to their run', async () => {
  const {set} = fixture()
  const first = deferred(), next = deferred()
  let calls = 0
  assert.equal(set.fork(input(() => { calls++; return first.promise })), 'Created')
  assert.equal(set.fork(input(() => { throw Error('busy must not dispatch') })), 'Nudged')
  const oldWait = set.awaitAgent('a')
  set.bindChildSession('a', 'child')
  const running = set.list().agents[0]
  assert.equal(running.status, 'Busy'); assert.equal(running.childSessionId, 'child')
  assert.equal(running.agent, 'coder'); assert.equal(running.currentRunId, 'run-1')
  await Promise.resolve(); assert.equal(calls, 1)
  first.resolve(completed('first'))
  const old = await oldWait
  assert.equal(old.ok, true); assert.equal(old.value.outcome.view, 'first')
  first.resolve(completed('must not overwrite'))
  assert.equal(set.list().agents[0].status, 'Idle')
  assert.equal(set.list().agents[0].terminalStatusLabel, 'completed')
  assert.equal(set.fork(input(() => next.promise)), 'Nudged')
  next.resolve(completed('second'))
  const second = await set.awaitAgent('a')
  assert.equal(second.value.runId, 'run-2'); assert.equal(second.value.outcome.runId, 'run-2')
  assert.equal((await oldWait).value.outcome.view, 'first')
  assert.throws(() => { old.value.outcome.view = 'mutated' }, TypeError)
})

test('timeout does not cancel a run, and work rejection is an ERROR completion', async () => {
  const {set} = fixture({raceExit: async () => false})
  const work = deferred()
  set.fork(input(() => work.promise))
  assert.deepEqual(await set.awaitAgent('missing'), {ok: false, error: 'Unknown agent id: missing'})
  for (const timeout of [0, -1, 3]) assert.deepEqual(await set.awaitAgent('a', timeout), {ok: false, error: 'await agent timed out: a'})
  assert.equal(set.activeRunCount, 1)
  work.reject(Error('work failed'))
  const settled = await set.awaitAgent('a')
  assert.equal(settled.ok, true); assert.equal(settled.value.outcome.kind, 'failed')
  assert.equal(settled.value.outcome.message, 'work failed'); assert.equal(settled.value.outcome.code, 'ERROR')
  assert.equal(set.list().agents[0].status, 'Idle'); assert.equal(set.list().agents[0].terminalStatusLabel, 'failed')
})

test('restored and interrupted runs remain incomplete; cancellation does not invent physical abort', async () => {
  const {set} = fixture()
  set.restore({agentId: 'r', agent: ' restored ', role: 'engineer'})
  set.bindChildSession('r', 'original')
  set.restore({agentId: 'r', agent: 'replacement', role: 'other'})
  set.markInterrupted('r', 'ignored')
  const restored = set.list().agents[0]
  assert.deepEqual([restored.agent, restored.childSessionId, restored.status, restored.currentRunId, restored.completionCellSettled], ['restored', 'original', 'Closed', 'restored-r', false])
  assert.equal((await set.awaitAgent('r', 0)).ok, false)
  const work = deferred()
  set.fork(input(() => work.promise))
  set.cancelAgent('a')
  assert.equal(set.list().agents.find(x => x.agentId === 'a').status, 'Closed')
  work.resolve(completed('late actual result'))
  assert.equal((await set.awaitAgent('a')).value.outcome.view, 'late actual result')
  assert.equal(set.list().agents.find(x => x.agentId === 'a').status, 'Idle')
})

test('completion status keeps interrupted and abandoned labels and completion wins over close', async () => {
  for (const [outcome, status, label] of [
    [{kind: 'failed', code: 'INTERRUPTED', message: 'stopped'}, 'Interrupted', 'stopped'],
    [{kind: 'abandoned', reason: 'Voided'}, 'Closed', 'Voided'],
  ]) {
    const {set} = fixture({onTerminal() { throw Error('listener') }})
    set.fork(input(async () => outcome)); await set.awaitAgent('a'); set.close()
    const record = set.list().agents[0]
    assert.equal(record.status, status); assert.equal(record.terminalStatusLabel, label)
    assert.equal(record.currentRunId, null); assert.equal(record.completionCellSettled, true)
  }
})

test('close releases waits and cleanup once, retaining PTY ownership until unregister', async () => {
  const cleaned = []
  const {set} = fixture({cleanup(id) { cleaned.push(id); throw Error('cleanup') }})
  set.restore({agentId: 'b', agent: 'b', role: 'r'})
  set.restore({agentId: 'a', agent: 'a', role: 'r'})
  const pty = {ptyId: 'p', command: 'cmd', startedAt: new Date(0)}
  set.registerPty(pty); pty.command = 'mutated'
  set.publishPtyCompletion('missing', {id: 'missing'})
  assert.equal(set.pendingPtyCount, 0)
  set.publishPtyCompletion('p', {id: 'p'})
  assert.deepEqual(set.drainPtyCompletions(1), [{id: 'p'}])
  const waiting = set.waitForWake()
  set.close(); set.close()
  assert.equal(await waiting, 'MailboxCancelled')
  assert.deepEqual(cleaned, ['a', 'b']); assert.equal(set.activeRunCount, 0)
  assert.equal(set.fork(input(async () => completed('never'))), 'NotFound')
  assert.equal(set.list().ptys[0].command, 'cmd')
  set.unregisterPty('p'); assert.equal(set.list().ptys.length, 0)
})
