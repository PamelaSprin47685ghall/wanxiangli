import test from 'node:test'
import assert from 'node:assert/strict'
import { Wait } from '../../../../dist/program/Program.js'
import { describe, registry } from './support.mjs'

test('WHAT[CAUSAL-WAIT-004] the observer capability exposes only Enter', () => {
  const runtime = registry()
  const observer = Wait.observerCapability(runtime)
  assert.equal(typeof observer.Enter, 'function')
  assert.equal(observer.Snapshot, undefined)
  assert.equal(observer.BindDiagnosticTarget, undefined)

  const lease = Wait.observerEnter(observer, describe())
  Wait.dispose(lease)
})

test('WHAT[CAUSAL-WAIT-004] the snapshot reader capability exposes only Snapshot', () => {
  const runtime = registry()
  const lease = Wait.enter(runtime, describe())
  const reader = Wait.snapshotReaderCapability(runtime)
  assert.equal(typeof reader.Snapshot, 'function')
  assert.equal(reader.Enter, undefined)

  const snapshot = reader.Snapshot()
  assert.equal(snapshot.active.length, 1)
  Wait.dispose(lease)
})

test('WHAT[CAUSAL-WAIT-004] a wrong capability shape is rejected, not coerced', () => {
  assert.throws(() => Wait.observerEnter({}, describe()))
  assert.throws(() => Wait.readerSnapshot({}))
})
