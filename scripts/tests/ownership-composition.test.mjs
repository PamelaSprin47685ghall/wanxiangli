import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Ownership } from 'wanxiangli/ownership'
import { SqliteJournal } from 'wanxiangli/eventstore'

function setup(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ownership-composition-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'history.sqlite')
  const connection = new DatabaseSync(file)
  const journal = new SqliteJournal(connection)
  t.after(() => journal.close())
  const owner = new Ownership('registry')
  const opened = owner.execute('open', { type: 'OpenScope', scopeId: 'work', parentId: null })
  assert.equal(journal.append('registry', 0, 'open', opened.record).status, 'Committed')
  return { owner, journal, connection, file }
}

for (const firstAction of ['reserve', 'drain']) {
  test(`SPEC[ownership-006] ${firstAction} wins the durable race; the other candidate cannot bypass admission`, t => {
    const { owner, journal } = setup(t)
    const reserving = new Ownership('registry', owner.records())
    const draining = new Ownership('registry', owner.records())
    const message = { type: 'Reserve', resourceId: 'child', scopeId: 'work', kind: 'process' }
    const reservation = reserving.execute('reserve', message)
    const drain = draining.execute('drain', { type: 'Drain', scopeId: 'work' })
    const first = firstAction === 'reserve' ? reservation : drain
    const second = firstAction === 'reserve' ? drain : reservation
    assert.equal(journal.append('registry', 1, firstAction, first.record).status, 'Committed')
    const rejectedId = firstAction === 'reserve' ? 'drain' : 'reserve'
    assert.equal(journal.append('registry', 1, rejectedId, second.record).status, 'Conflict')
    const current = new Ownership('registry', journal.read('registry'))
    if (firstAction === 'drain') {
      assert.throws(() => current.execute('retry-reserve', message), /admission/)
      assert.equal(current.blockers('work').length, 0)
    } else {
      const nextDrain = current.execute('retry-drain', { type: 'Drain', scopeId: 'work' })
      assert.equal(journal.append('registry', 2, 'retry-drain', nextDrain.record).status, 'Committed')
      assert.equal(current.blockers('work').length, 1)
      assert.equal(current.blockers('work')[0].cancellationRequested, true)
    }
  })
}

for (const committed of [false, true]) {
  test(`SPEC[ownership-006] losing a reservation acknowledgement ${committed ? 'after' : 'before'} commit never permits launch`, t => {
    const { owner, journal, connection, file } = setup(t)
    const candidate = new Ownership('registry', owner.records())
    const proposed = candidate.execute('reserve', { type: 'Reserve', resourceId: 'child', scopeId: 'work', kind: 'process' })
    const execute = connection.exec.bind(connection)
    connection.exec = sql => {
      if (sql === 'COMMIT') {
        if (committed) execute(sql)
        throw new Error('Lost acknowledgement')
      }
      return execute(sql)
    }
    const result = journal.append('registry', 1, 'reserve', proposed.record)
    assert.equal(result.status, 'Unknown')
    assert.notEqual(result.status, 'Committed')
    assert.equal(owner.inspect().resources, 0)
    const reopened = new SqliteJournal(new DatabaseSync(file))
    t.after(() => reopened.close())
    const restored = new Ownership('registry', reopened.read('registry'))
    assert.equal(restored.blockers('work').length, committed ? 1 : 0)
    if (committed) {
      assert.throws(() => restored.execute('close', { type: 'Close', scopeId: 'work' }), /unsettled/)
      assert.equal(restored.execute('reserve', { type: 'Reserve', resourceId: 'child', scopeId: 'work', kind: 'process' }).status, 'Replayed')
    }
  })
}

test('SPEC[ownership-006] identical concurrent reservations produce only one fresh durable commit', t => {
  const { owner, journal } = setup(t)
  const message = { type: 'Reserve', resourceId: 'child', scopeId: 'work', kind: 'process' }
  const first = new Ownership('registry', owner.records()).execute('same-request', message)
  const second = new Ownership('registry', owner.records()).execute('same-request', message)
  assert.equal(first.record, second.record)
  assert.equal(journal.append('registry', 1, 'same-request', first.record).status, 'Committed')
  assert.equal(journal.append('registry', 1, 'same-request', second.record).status, 'Replayed')
  const current = new Ownership('registry', journal.read('registry'))
  assert.equal(current.inspect().resources, 1)
  assert.equal(current.execute('same-request', message).status, 'Replayed')
})
