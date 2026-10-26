import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SqliteJournal } from 'wanxiangli/eventstore'
import { DurableWork } from 'wanxiangli/durable-work'

export function countingPorts(overrides = {}) {
  const counts = { ask: 0, dispatch: 0, createSession: 0, sendDraft: 0, stop: 0 }
  const ids = []
  const ports = {
    counts,
    ids,
    ask(effect) { counts.ask += 1; ids.push(effect.id); return 'Parked' },
    dispatch(effect) { counts.dispatch += 1; ids.push(effect.id); return 'Sent' },
    createSession(effect) {
      counts.createSession += 1
      ids.push(effect.id)
      return { status: 'SessionCreated', execSessionId: `session-${counts.createSession}` }
    },
    sendDraft(effect) { counts.sendDraft += 1; ids.push(effect.id); return 'Admitted' },
    stop(effect) { counts.stop += 1; ids.push(effect.id); return 'Requested' },
    ...overrides,
  }
  return ports
}

export class Rig {
  serial = 0
  constructor(t, effects = undefined) {
    const directory = mkdtempSync(path.join(tmpdir(), 'wanxiangli-composition-'))
    this.path = path.join(directory, 'work.sqlite')
    this.journals = []
    this.effects = effects
    t.after(() => {
      for (const journal of this.journals) journal.close()
      rmSync(directory, { recursive: true, force: true })
    })
    this.journal = this.connect()
    this.work = this.open(this.journal)
  }
  connect() {
    const journal = new SqliteJournal(new DatabaseSync(this.path))
    this.journals.push(journal)
    return journal
  }
  open(journal) { return new DurableWork('work-a', journal, this.effects) }
  reopen() { return this.open(this.connect()) }
  call(command, requestId = `request-${++this.serial}`) { return this.work.execute(requestId, command) }
  commit(command, requestId) {
    const reply = this.call(command, requestId)
    assert.equal(reply.status, 'Committed', JSON.stringify(reply))
    return reply.result
  }
  review(updates = [], overrides = {}, requestId) {
    const command = {
      type: 'Review',
      office: 'Plan',
      providerRunId: 'run',
      toolCallId: `call-${++this.serial}`,
      updates,
      ...overrides,
    }
    this.lastCommand = command
    return this.commit(command, requestId)
  }
}
