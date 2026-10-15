import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Wait } from '../../../dist/wait/Wait.js'
import { describe, registry } from './support.mjs'

test('WHAT[CAUSAL-WAIT-003] the module writes nothing durable', async () => {
  const source = await readFile(new URL('../../../dist/wait/Wait.js', import.meta.url), 'utf8')
  assert.equal(source.includes('node:fs'), false)
  assert.equal(source.includes('node:sqlite'), false)
  assert.equal(source.includes('writeFile'), false)
})

test('WHAT[CAUSAL-WAIT-003] a bound diagnostic sink receives snapshots, never business authority', () => {
  const runtime = registry()
  const received = []
  const bound = Wait.bindDiagnosticTarget(runtime, { Publish: snapshot => received.push(snapshot) })
  assert.equal(bound, true)

  const lease = Wait.enter(runtime, describe())
  Wait.dispose(lease)

  assert.ok(received.length >= 2)
  assert.equal(received[0].active.length, 1)
  assert.equal(received[received.length - 1].active.length, 0)
})

test('WHAT[CAUSAL-WAIT-003] a throwing sink cannot break waits or hide their lifecycle', () => {
  const runtime = registry()
  assert.equal(
    Wait.bindDiagnosticTarget(runtime, {
      Publish: () => { throw new Error('diagnostic channel is down') },
    }),
    true,
  )

  const lease = Wait.enter(runtime, describe())
  Wait.markExit(lease, 'WaitResolved')
  Wait.dispose(lease)

  const snapshot = Wait.snapshot(runtime)
  assert.equal(snapshot.active.length, 0)
  assert.equal(snapshot.history[snapshot.history.length - 1].exit, 'WaitResolved')
})

test('WHAT[CAUSAL-WAIT-003] the diagnostic target binds once and cannot be redirected', () => {
  const runtime = registry()
  const first = { Publish: () => {} }
  const second = { Publish: () => {} }
  assert.equal(Wait.bindDiagnosticTarget(runtime, first), true)
  assert.equal(Wait.bindDiagnosticTarget(runtime, second), false)
})
