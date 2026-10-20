import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createJournal, temporary, worker, message, kill } from './support.mjs'

test('SPEC[eventstore-001] durable append preserves exact UTF-8 text across close and reopen', t => {
  const database = temporary(t)
  const body = '\ufeff用户原文\n\r\n🧭 e\u0301 \u0000 end'
  const first = createJournal(database)
  assert.deepEqual(first.append('stream', 0, 'request', body), { status: 'Committed', revision: 1, reason: null })
  first.close()
  const restored = createJournal(database)
  t.after(() => restored.close())
  assert.deepEqual(restored.read('stream'), [body])
  assert.deepEqual(Buffer.from(restored.read('stream')[0]), Buffer.from(body))
  assert.equal(restored.append('stream', 0, 'request', body).status, 'Replayed')
})

test('SPEC[eventstore-001] revision comparison is per stream and request collision never overwrites', t => {
  const journal = createJournal(temporary(t))
  t.after(() => journal.close())
  assert.equal(journal.append('a', 0, 'same-id', 'first').status, 'Committed')
  assert.equal(journal.append('a', 0, 'other-id', 'second').status, 'Conflict')
  assert.equal(journal.append('a', 1, 'same-id', 'changed').status, 'Conflict')
  assert.equal(journal.append('b', 0, 'same-id', 'independent').status, 'Committed')
  assert.deepEqual(journal.read('a'), ['first'])
  assert.deepEqual(journal.read('b'), ['independent'])
})

test('SPEC[eventstore-001] two real processes cannot both win revision zero', { timeout: 20000 }, async t => {
  const database = temporary(t)
  createJournal(database).close()
  const first = worker(t, database, 'race', 'first')
  const second = worker(t, database, 'race', 'second')
  await Promise.all([message(first), message(second)])
  const results = [message(first), message(second)]
  const exits = [once(first, 'exit'), once(second, 'exit')]
  first.send('go')
  second.send('go')
  const replies = (await Promise.all(results)).map(value => value.reply)
  // Each worker closes its connection after replying; the last close checkpoints
  // the WAL. Reopen only after both have exited, or busy_timeout=0 races that close.
  await Promise.all(exits)
  assert.equal(replies.filter(reply => reply.status === 'Committed').length, 1)
  assert.ok(replies.some(reply => ['NotWritten', 'Conflict'].includes(reply.status)))
  const journal = createJournal(database)
  t.after(() => journal.close())
  assert.equal(journal.read('race').length, 1)
})

test('SPEC[eventstore-001] SIGKILL after acknowledged commit preserves the entire transaction', { timeout: 20000, skip: process.platform === 'win32' }, async t => {
  const database = temporary(t)
  const body = JSON.stringify({ first: '退休', second: '后任开立', text: '🧭'.repeat(1024) })
  const child = worker(t, database, 'kill-after-commit', body)
  const reached = await message(child)
  assert.equal(reached.phase, 'committed')
  assert.equal(reached.reply.status, 'Committed')
  await kill(child)
  const restored = createJournal(database)
  t.after(() => restored.close())
  assert.deepEqual(restored.read('crash'), [body])
  assert.equal(restored.append('crash', 0, 'crash-request', body).status, 'Replayed')
})

test('SPEC[eventstore-001] SIGKILL inside production append before COMMIT exposes no half transaction', { timeout: 20000, skip: process.platform === 'win32' }, async t => {
  const database = temporary(t)
  const child = worker(t, database, 'kill-before-commit', JSON.stringify({ events: ['retired', 'successor'] }))
  assert.equal((await message(child)).phase, 'before-commit')
  await kill(child)
  const restored = createJournal(database)
  t.after(() => restored.close())
  assert.deepEqual(restored.read('crash'), [])
  assert.equal(restored.append('crash', 0, 'new-request', 'fresh').status, 'Committed')
})
