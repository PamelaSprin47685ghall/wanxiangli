import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { DurableWork } from 'wanxiangli/durable-work'
import { Rig, countingPorts } from './support.mjs'

const worker = fileURLToPath(new URL('./kill-worker.mjs', import.meta.url))

function reachReady(rig) {
  for (const milestone of ['理解与路径', '流程与伪代码', '待执行']) {
    rig.review([{ key: 'item', value: 'keep' }])
    const relay = rig.review([{ key: 'item', value: null }])
    assert.equal(relay.kind, 'Relayed')
    const advanced = rig.review([])
    assert.equal(advanced.kind, 'Advanced')
    assert.equal(advanced.milestone, milestone)
  }
  assert.equal(rig.work.inspect().milestone, '待执行')
}

test('SPEC[assembly-004] ask, relay, advance, launch and stop each run one external effect', t => {
  const asked = countingPorts()
  const askRig = new Rig(t, asked)
  const askCommand = { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'ask-1', updates: [] }
  const ask = askRig.call(askCommand, 'ask-1')
  assert.equal(ask.result.kind, 'Asked')
  assert.equal(ask.result.effect.text, '我需要干什么？')
  assert.equal(asked.counts.ask, 1)
  assert.equal(askRig.call(askCommand, 'ask-1').status, 'Replayed')
  assert.equal(asked.counts.ask, 1)
  const late = askRig.call({ type: 'Confirm', effectId: ask.result.effect.id, outcome: 'Parked' }, `confirm:${ask.result.effect.id}:Parked`)
  assert.equal(late.status, 'Replayed')
  assert.equal(asked.counts.ask, 1)
  console.log(`ask external ${asked.counts.ask}`)

  const prompts = countingPorts()
  const promptRig = new Rig(t, prompts)
  promptRig.review([{ key: 'gap', value: 'fix' }])
  const beforeRelay = prompts.counts.dispatch
  const relay = promptRig.review([{ key: 'gap', value: null }], {}, 'relay-1')
  assert.equal(relay.kind, 'Relayed')
  assert.equal(prompts.counts.dispatch, beforeRelay + 1)
  const relayId = relay.effect.id
  assert.equal(promptRig.call(promptRig.lastCommand, 'relay-1').status, 'Replayed')
  assert.equal(prompts.ids.filter(id => id === relayId).length, 1)
  const beforeAdvance = prompts.counts.dispatch
  const advanced = promptRig.review([])
  assert.equal(advanced.kind, 'Advanced')
  assert.equal(advanced.milestone, '理解与路径')
  assert.equal(prompts.counts.dispatch, beforeAdvance + 1)
  console.log(`relay external 1`)
  console.log(`advance external 1`)

  const launches = countingPorts()
  const launchRig = new Rig(t, launches)
  reachReady(launchRig)
  const launch = { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'launch-1', updates: [], digest: '待执行' }
  const started = launchRig.call(launch, 'launch-1')
  assert.equal(started.result.kind, 'Launched')
  assert.equal(launches.counts.createSession, 1)
  assert.equal(launches.counts.sendDraft, 1)
  assert.equal(launchRig.call(launch, 'launch-1').status, 'Replayed')
  assert.equal(launches.counts.createSession, 1)
  assert.equal(launches.counts.sendDraft, 1)
  for (const toolCallId of ['launch-2', 'launch-3', 'launch-4']) {
    assert.equal(launchRig.call({ ...launch, toolCallId }, toolCallId).status, 'Committed')
  }
  assert.equal(launches.counts.createSession, 4)
  assert.equal(launches.counts.sendDraft, 4)
  assert.equal(launchRig.work.inspect().launches.length, 4)
  assert.equal(new Set(launchRig.work.inspect().launches.map(item => item.id)).size, 4)
  assert.equal(launchRig.work.inspect().milestone, '待执行')
  console.log(`launch external 1`)

  const stops = countingPorts()
  const stopRig = new Rig(t, stops)
  stopRig.review([{ key: 'job', value: 'run' }], { office: 'Manager' })
  assert.equal(stopRig.review([{ key: 'job', value: null }], { office: 'Manager' }).kind, 'Relayed')
  assert.equal(stopRig.review([], { office: 'Manager' }).milestone, '收尾')
  const finished = stopRig.review([], { office: 'Manager' }, 'finish')
  assert.equal(finished.kind, 'Completed')
  assert.equal(stops.counts.stop, 1)
  assert.equal(stopRig.call(stopRig.lastCommand, 'finish').status, 'Replayed')
  assert.equal(stops.counts.stop, 1)
  console.log(`stop external ${stops.counts.stop}`)
})

test('SPEC[assembly-004] an unknown session does not send and does not start another manager', t => {
  const ports = countingPorts({
    createSession(effect) {
      ports.counts.createSession += 1
      ports.ids.push(effect.id)
      return { status: 'Unknown' }
    },
  })
  const rig = new Rig(t, ports)
  reachReady(rig)
  const beforeSend = ports.counts.sendDraft
  const command = { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'unknown-launch', updates: [] }
  const reply = rig.call(command, 'unknown-launch')
  assert.equal(reply.status, 'Committed')
  assert.equal(ports.counts.createSession, 1)
  assert.equal(ports.counts.sendDraft, beforeSend)
  assert.equal(rig.reopen().recover().effect, null)
  assert.equal(ports.counts.createSession, 1)
  assert.equal(ports.counts.sendDraft, beforeSend)
  assert.equal(rig.work.inspect().launches.filter(item => item.status === 'Unknown').length, 1)
  console.log('unknown send 0')
  console.log('unknown managers 1')
})

test('SPEC[assembly-004] a refused session does not send a draft', t => {
  const ports = countingPorts({
    createSession(effect) {
      ports.counts.createSession += 1
      ports.ids.push(effect.id)
      return { status: 'NotStarted', reason: 'refused' }
    },
  })
  const rig = new Rig(t, ports)
  reachReady(rig)
  const beforeSend = ports.counts.sendDraft
  assert.equal(rig.call({ type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'refused', updates: [] }, 'refused').status, 'Committed')
  assert.equal(ports.counts.createSession, 1)
  assert.equal(ports.counts.sendDraft, beforeSend)
  assert.equal(rig.work.inspect().launches[0].status, 'Rejected')
})

test('SPEC[assembly-004] a revision conflict does not run a second effect', t => {
  const ports = countingPorts()
  const rig = new Rig(t, ports)
  reachReady(rig)
  const other = rig.reopen()
  const command = { type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'launch-a', updates: [] }
  const append = rig.journal.append.bind(rig.journal)
  let winner
  rig.journal.append = (...args) => {
    if (!winner) winner = other.execute('launch-b', { ...command, toolCallId: 'launch-b' })
    return append(...args)
  }
  const loser = rig.call(command, 'launch-a')
  assert.equal(winner.status, 'Committed')
  assert.equal(loser.status, 'Conflict')
  assert.equal(ports.counts.createSession, 1)
  assert.equal(ports.counts.sendDraft, 1)
  console.log(`conflict external ${ports.counts.createSession}`)
})

test('SPEC[assembly-004] journal unknown does not send, and a landed reservation is filled once', t => {
  const silent = countingPorts()
  const hidden = new Rig(t, silent)
  const append = hidden.journal.append.bind(hidden.journal)
  hidden.journal.append = () => ({ status: 'Unknown', revision: 0, reason: 'storage unknown' })
  const reply = hidden.call({ type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'ask', updates: [] }, 'ask')
  assert.equal(reply.status, 'Unknown')
  assert.equal(silent.counts.ask, 0)
  assert.equal(hidden.reopen().recover().effect, null)
  assert.equal(silent.counts.ask, 0)

  const filled = countingPorts()
  const rig = new Rig(t, filled)
  const real = rig.journal.append.bind(rig.journal)
  rig.journal.append = (...args) => {
    const receipt = real(...args)
    if (args[2] === 'landed') throw new Error('Lost acknowledgement')
    return receipt
  }
  const lost = rig.call({ type: 'Review', office: 'Plan', providerRunId: 'run', toolCallId: 'landed', updates: [] }, 'landed')
  assert.equal(lost.status, 'Unknown')
  assert.equal(filled.counts.ask, 0)
  const restored = rig.reopen()
  assert.equal(restored.recover().effect, null)
  assert.equal(filled.counts.ask, 1)
  assert.equal(restored.inspect().wait, 'AwaitOperatorAnswer')
  assert.equal(restored.recover().effect, null)
  assert.equal(filled.counts.ask, 1)
  console.log(`unknown fill ask ${filled.counts.ask}`)
})

test('SPEC[assembly-004] a killed process fills one pending effect with the same identity', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wanxiangli-kill-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  for (const mode of ['ask', 'relay', 'advance', 'launch', 'stop', 'send']) {
    const database = path.join(directory, `${mode}.sqlite`)
    const child = spawn(process.execPath, [worker, database, mode], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk })
    const [code, signal] = await once(child, 'exit')
    assert.equal(signal, 'SIGKILL', `${mode} exited ${code}\n${stderr}`)
    const ports = countingPorts()
    const journal = new SqliteJournal(new DatabaseSync(database))
    t.after(() => journal.close())
    const work = new DurableWork('work-a', journal, ports)
    const pending = work.recover()
    assert.equal(pending.effect, null, JSON.stringify(pending))
    const kind = { ask: 'ask', relay: 'dispatch', advance: 'dispatch', launch: 'createSession', stop: 'stop', send: 'sendDraft' }[mode]
    assert.equal(ports.counts[kind], 1, JSON.stringify(ports.counts))
    if (mode === 'launch') assert.equal(ports.counts.sendDraft, 1)
    if (mode === 'send') assert.equal(ports.counts.createSession, 0)
    const identity = ports.ids.at(-1)
    const recorded = journal.read('work-a').flatMap(body => JSON.parse(body).events).find(event =>
      event.questionId === identity || event.promptId === identity || event.operationId === identity || event.stopId === identity)
    assert.equal(recorded === undefined, false)
    console.log(`kill ${mode} ${identity} 1`)
  }
})
