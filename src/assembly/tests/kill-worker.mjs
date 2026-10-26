import { DatabaseSync } from 'node:sqlite'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { DurableWork } from 'wanxiangli/durable-work'

const [database, mode] = process.argv.slice(2)
const journal = new SqliteJournal(new DatabaseSync(database))
const real = journal.append.bind(journal)
journal.append = (stream, revision, requestId, body) => {
  const receipt = real(stream, revision, requestId, body)
  const killSend = mode === 'send' && requestId.startsWith('confirm:') && requestId.includes(':SessionCreated:')
  if ((mode !== 'send' && requestId === 'target') || killSend) process.kill(process.pid, 'SIGKILL')
  return receipt
}
const ports = {
  ask() { return 'Parked' },
  dispatch() { return 'Sent' },
  createSession() { return { status: 'SessionCreated', execSessionId: 'session-killed' } },
  sendDraft() { return 'Admitted' },
  stop() { return 'Requested' },
}
const work = new DurableWork('work-a', journal, ports)

function commit(requestId, command) {
  const reply = work.execute(requestId, command)
  if (reply.status !== 'Committed') throw new Error(JSON.stringify(reply))
  return reply.result
}

function review(requestId, office, updates, extra = {}) {
  return commit(requestId, { type: 'Review', office, providerRunId: 'run', toolCallId: requestId, updates, ...extra })
}

if (mode === 'ask') review('target', 'Plan', [])
else if (mode === 'relay') {
  review('keep', 'Plan', [{ key: 'gap', value: 'fix' }])
  review('target', 'Plan', [{ key: 'gap', value: null }])
} else if (mode === 'advance') {
  review('keep', 'Plan', [{ key: 'gap', value: 'fix' }])
  review('clear', 'Plan', [{ key: 'gap', value: null }])
  review('target', 'Plan', [])
} else if (mode === 'launch' || mode === 'send') {
  for (const milestone of ['理解与路径', '流程与伪代码', '待执行']) {
    review(`keep-${milestone}`, 'Plan', [{ key: 'item', value: 'keep' }])
    review(`clear-${milestone}`, 'Plan', [{ key: 'item', value: null }])
    const advanced = review(`advance-${milestone}`, 'Plan', [])
    if (advanced.milestone !== milestone) throw new Error(advanced.milestone)
  }
  review('target', 'Plan', [], { digest: '待执行' })
} else if (mode === 'stop') {
  review('keep', 'Manager', [{ key: 'job', value: 'run' }])
  review('clear', 'Manager', [{ key: 'job', value: null }])
  const advanced = review('advance', 'Manager', [])
  if (advanced.milestone !== '收尾') throw new Error(advanced.milestone)
  review('target', 'Manager', [])
} else throw new Error(`Unknown kill mode ${mode}`)
