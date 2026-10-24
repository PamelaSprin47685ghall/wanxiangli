import test from 'node:test'
import assert from 'node:assert/strict'
import { ProcessSession } from 'wanxiangli/runtime'
import { options, session, ready, closed, output } from './support.mjs'

test('SPEC[process-005] the generated object exposes messages, not process handles or buffers', async t => {
  const run = session(t, 'echo')
  await ready(run)
  assert.deepEqual(Object.keys(run).sort(), ['endInput', 'inspect', 'read', 'signal', 'started', 'wait', 'write'])
  assert.equal(run.child, undefined)
  assert.equal(run.stdout, undefined)
  assert.equal(run.waits, undefined)
  const start = await run.started()
  start.pid = 0
  assert.notEqual((await run.started()).pid, 0)
  const view = run.inspect()
  view.stdout.observed = 999
  view.phase = 'Closed'
  assert.equal(run.inspect().stdout.observed, 0)
  assert.equal(run.inspect().phase, 'Running')
  await run.write(Buffer.from('immutable observation'))
  run.endInput()
  await closed(run)
  output(run).bytes.fill(0)
  assert.equal(output(run).text, 'immutable observation')
})

test('SPEC[process-005] two actual instances do not share signals, input or output', async t => {
  const left = session(t, 'echo')
  const right = session(t, 'echo')
  await Promise.all([ready(left), ready(right)])
  await Promise.all([left.write(Buffer.from('left')), right.write(Buffer.from('right'))])
  left.signal('SIGKILL')
  await closed(left)
  assert.equal(right.inspect().phase, 'Running')
  right.endInput()
  await closed(right)
  assert.equal(output(right).text, 'right')
})

test('SPEC[process-005] modifying startup options after construction cannot rewrite the child environment', async t => {
  const input = options('report', ['original'], { env: { MESSAGE: 'original' } })
  const run = new ProcessSession(input)
  t.after(async () => { await run.started(); run.signal('SIGKILL'); await closed(run) })
  input.env.MESSAGE = 'rewritten'
  input.args[2] = 'rewritten'
  await closed(run)
  const report = JSON.parse(output(run).text)
  assert.equal(report.env.MESSAGE, 'original')
  assert.deepEqual(report.args, ['original'])
})
