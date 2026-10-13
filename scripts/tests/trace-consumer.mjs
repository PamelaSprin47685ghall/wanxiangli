import assert from 'node:assert/strict'
import { Trace } from 'wanxiangli/trace'

const [runtime, mode, database, checkpointJson] = process.argv.slice(2)
const id = 'installed-trace'
const source = Uint8Array.from([...new TextEncoder().encode('\ufeff用户原件\r\n🧭e\u0301\u0000'), 255, 128])
const observed = { type: 'MessageObserved', messageId: 'user', role: 'user', origin: 'human', runId: null }
const confirmed = { type: 'PartConfirmed', messageId: 'user', partId: 'original', index: 0, kind: 'binary', bytes: source }
const finished = { type: 'MessageFinished', messageId: 'user', partCount: 1 }
assert.deepEqual(Object.keys(await import('wanxiangli/trace')), ['Trace'])

if (mode === 'isolated') {
  const trace = new Trace(id)
  for (const observation of [observed, confirmed, finished]) trace.capture(observation)
  const restored = new Trace(id, trace.records())
  const before = restored.head()
  assert.deepEqual(restored.materialize(restored.cut(0), before).originals[0].parts[0].content.bytes, source)
  const data = Uint8Array.of(1, 2, 3)
  Object.defineProperty(data, 'buffer', { get() { throw Error('must not invoke') } })
  restored.capture({ ...observed, messageId: 'another' })
  restored.capture({ ...confirmed, messageId: 'another', bytes: data })
  assert.equal(restored.read(restored.cut(0), before).length, 3)
  console.log(JSON.stringify({ runtime, isolated: true, bytes: source.length }))
} else {
  const { SqliteJournal } = await import('wanxiangli/eventstore')
  const open = () => runtime === 'node'
    ? import('node:sqlite').then(({ DatabaseSync }) => new DatabaseSync(database))
    : import('bun:sqlite').then(({ Database }) => new Database(database))
  const journal = new SqliteJournal(await open())
  let trace = new Trace(id, journal.read(id))

  // 这是消费者的 C：分别使用两个真实对象，成功提交前不发布候选。
  function capture(observation) {
    const candidate = new Trace(id, trace.records())
    const receipt = candidate.capture(observation)
    if (receipt.status === 'Replayed') return receipt
    const result = journal.append(id, trace.head().cursor, candidate.head().digest, receipt.record)
    assert.equal(result.status, 'Committed', JSON.stringify(result))
    trace = candidate
    return receipt
  }

  if (mode === 'start') {
    for (const observation of [observed, confirmed, finished]) capture(observation)
    capture({ type: 'RunStarted', runId: 'run' })
    capture({ type: 'MessageObserved', messageId: 'assistant', role: 'assistant', origin: 'provider', runId: 'run' })
    capture({ ...confirmed, messageId: 'assistant', bytes: new TextEncoder().encode('可核对的结论'), kind: 'text' })
    capture({ ...finished, messageId: 'assistant' })
    capture({ type: 'RunFinished', runId: 'run', outcome: 'Completed' })
    console.log(JSON.stringify({ phase: 'committed', checkpoint: trace.head() }))
    // 保持原生连接打开；父测试在确认提交后强杀这个真实进程。
    setInterval(() => {}, 1000)
  } else {
    assert.equal(mode, 'recover')
    const checkpoint = JSON.parse(checkpointJson)
    assert.deepEqual(trace.head(), checkpoint)
    const frozen = trace.materialize(trace.cut(0), checkpoint)
    assert.deepEqual(frozen.originals[0].parts[0].content.bytes, source)
    assert.equal(frozen.originals[0].parts[0].content.text, null)
    assert.equal(frozen.statement.content.text, '可核对的结论')
    const records = journal.read(id)
    assert.equal(capture(confirmed).status, 'Replayed')
    assert.deepEqual(journal.read(id), records)
    capture({ ...observed, messageId: 'later-user' })
    assert.deepEqual(trace.materialize(trace.cut(0), checkpoint), frozen)
    assert.deepEqual(new Trace(id, journal.read(id)).records(), trace.records())
    journal.close()
    console.log(JSON.stringify({ runtime, recovered: true, bytes: source.length, cursor: trace.head().cursor }))
  }
}
