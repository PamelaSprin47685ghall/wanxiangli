import test from 'node:test'
import assert from 'node:assert/strict'

import { ManagedChatExecutionFlight, managedChatExecutionFlight } from 'wanxiangli/chat-execution'

test('SPEC[flight-001]: beginFlight registers work and tryGet/get retrieves it', () => {
  const flight = new ManagedChatExecutionFlight()
  const work = { taskName: 'chat-execution-test-1', timestamp: Date.now() }

  assert.equal(flight.count(), 0)
  assert.equal(flight.tryGet('rt-1', 'ses-1', 'msg-1'), undefined)
  assert.equal(flight.get('rt-1', 'ses-1', 'msg-1'), null)

  flight.beginFlight('rt-1', 'ses-1', 'msg-1', work)

  assert.equal(flight.count(), 1)
  assert.equal(flight.tryGet('rt-1', 'ses-1', 'msg-1'), work)
  assert.equal(flight.get('rt-1', 'ses-1', 'msg-1'), work)
})

test('SPEC[flight-002]: finish removes entry and returns boolean status', () => {
  const flight = new ManagedChatExecutionFlight()
  const work = { taskName: 'chat-execution-test-2' }

  flight.beginFlight('rt-1', 'ses-1', 'msg-1', work)
  assert.equal(flight.count(), 1)

  const removed = flight.finish('rt-1', 'ses-1', 'msg-1')
  assert.equal(removed, true)
  assert.equal(flight.count(), 0)
  assert.equal(flight.tryGet('rt-1', 'ses-1', 'msg-1'), undefined)
  assert.equal(flight.get('rt-1', 'ses-1', 'msg-1'), null)

  // Subsequent finish returns false
  const removedAgain = flight.finish('rt-1', 'ses-1', 'msg-1')
  assert.equal(removedAgain, false)
})

test('SPEC[flight-003]: isolation across runtimeId, sessionId, and physicalUserMessageId', () => {
  const flight = new ManagedChatExecutionFlight()
  const work = { taskName: 'multi-dimension-isolation' }

  flight.beginFlight('rt-alpha', 'ses-bravo', 'msg-charlie', work)

  // Different runtimeId
  assert.equal(flight.tryGet('rt-diff', 'ses-bravo', 'msg-charlie'), undefined)
  assert.equal(flight.get('rt-diff', 'ses-bravo', 'msg-charlie'), null)

  // Different sessionId
  assert.equal(flight.tryGet('rt-alpha', 'ses-diff', 'msg-charlie'), undefined)
  assert.equal(flight.get('rt-alpha', 'ses-diff', 'msg-charlie'), null)

  // Different physicalUserMessageId
  assert.equal(flight.tryGet('rt-alpha', 'ses-bravo', 'msg-diff'), undefined)
  assert.equal(flight.get('rt-alpha', 'ses-bravo', 'msg-diff'), null)

  // Exact match succeeds
  assert.equal(flight.tryGet('rt-alpha', 'ses-bravo', 'msg-charlie'), work)
})

test('SPEC[flight-004]: defensive key normalization for null and undefined', () => {
  const flight = new ManagedChatExecutionFlight()
  const work1 = { id: 'null-work' }

  flight.beginFlight(null, undefined, 'msg-1', work1)
  assert.equal(flight.tryGet('', '', 'msg-1'), work1)
  assert.equal(flight.tryGet(undefined, null, 'msg-1'), work1)

  const work2 = { id: 'all-empty' }
  flight.beginFlight(null, null, null, work2)
  assert.equal(flight.tryGet('', '', ''), work2)
  assert.equal(flight.tryGet(undefined, undefined, undefined), work2)
})

test('SPEC[flight-005]: multiple instances are strictly isolated', () => {
  const flightA = new ManagedChatExecutionFlight()
  const flightB = new ManagedChatExecutionFlight()

  const workA = { tag: 'A' }
  const workB = { tag: 'B' }

  flightA.beginFlight('rt-1', 'ses-1', 'msg-1', workA)
  flightB.beginFlight('rt-1', 'ses-1', 'msg-1', workB)

  assert.equal(flightA.tryGet('rt-1', 'ses-1', 'msg-1'), workA)
  assert.equal(flightB.tryGet('rt-1', 'ses-1', 'msg-1'), workB)

  flightA.finish('rt-1', 'ses-1', 'msg-1')
  assert.equal(flightA.tryGet('rt-1', 'ses-1', 'msg-1'), undefined)
  assert.equal(flightB.tryGet('rt-1', 'ses-1', 'msg-1'), workB)
})

test('SPEC[flight-006]: global singleton managedChatExecutionFlight isolation and operation', () => {
  assert.ok(managedChatExecutionFlight instanceof ManagedChatExecutionFlight)
  managedChatExecutionFlight.clear()

  const localFlight = new ManagedChatExecutionFlight()
  const workSingleton = { tag: 'singleton-work' }

  managedChatExecutionFlight.beginFlight('rt-s', 'ses-s', 'msg-s', workSingleton)

  assert.equal(managedChatExecutionFlight.tryGet('rt-s', 'ses-s', 'msg-s'), workSingleton)
  assert.equal(localFlight.tryGet('rt-s', 'ses-s', 'msg-s'), undefined)

  managedChatExecutionFlight.clear()
  assert.equal(managedChatExecutionFlight.count(), 0)
  assert.equal(managedChatExecutionFlight.tryGet('rt-s', 'ses-s', 'msg-s'), undefined)
})

test('SPEC[flight-007]: clear resets in-flight tracking for instance', () => {
  const flight = new ManagedChatExecutionFlight()
  flight.beginFlight('rt-1', 'ses-1', 'msg-1', { id: 1 })
  flight.beginFlight('rt-1', 'ses-1', 'msg-2', { id: 2 })
  flight.beginFlight('rt-2', 'ses-2', 'msg-1', { id: 3 })

  assert.equal(flight.count(), 3)
  flight.clear()
  assert.equal(flight.count(), 0)
  assert.equal(flight.tryGet('rt-1', 'ses-1', 'msg-1'), undefined)
  assert.equal(flight.tryGet('rt-1', 'ses-1', 'msg-2'), undefined)
  assert.equal(flight.tryGet('rt-2', 'ses-2', 'msg-1'), undefined)
})

test('SPEC[flight-008]: PascalCase aliases parity with camelCase', () => {
  const flight = new ManagedChatExecutionFlight()
  const work = { id: 'pascal-test' }

  flight.BeginFlight('rt-p', 'ses-p', 'msg-p', work)
  assert.equal(flight.Count, 1)
  assert.equal(flight.TryGet('rt-p', 'ses-p', 'msg-p'), work)
  assert.equal(flight.Get('rt-p', 'ses-p', 'msg-p'), work)

  const finished = flight.Finish('rt-p', 'ses-p', 'msg-p')
  assert.equal(finished, true)
  assert.equal(flight.Count, 0)
  assert.equal(flight.TryGet('rt-p', 'ses-p', 'msg-p'), undefined)

  flight.BeginFlight('rt-p2', 'ses-p2', 'msg-p2', work)
  assert.equal(flight.Count, 1)
  flight.Clear()
  assert.equal(flight.Count, 0)
})
