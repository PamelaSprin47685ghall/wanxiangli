import test from 'node:test'
import assert from 'node:assert/strict'
import { outboundViewStore, OutboundViewStore, PairHint } from '../../../dist/pair-hint/PairHint.js'

test('SPEC[pair-hint-016] OutboundViewStore: progressive checkAndSeal seals only when messages, system, and model are all non-empty', () => {
  const store = new OutboundViewStore()
  const sid = 'sess-prog-01'

  // Step 1: record only system
  store.recordSystem(sid, ['You are an assistant.'])
  assert.equal(store.tryGetSealed(sid), undefined, 'partial pending must not seal')

  // Step 2: record only model
  store.recordModel(sid, { providerID: 'anthropic', modelID: 'claude-3-5-sonnet', variant: 'high' })
  assert.equal(store.tryGetSealed(sid), undefined, 'missing messages must not seal')

  // Step 3: record messages -> all 3 present, should seal
  const msgs = [{ info: { role: 'user', sessionID: sid }, content: 'hello' }]
  store.recordMessagesFor(sid, msgs)

  const sealed = store.tryGetSealed(sid)
  assert.ok(sealed, 'sealed snapshot must exist')
  assert.equal(sealed.sessionId, sid)
  assert.deepEqual(sealed.system, ['You are an assistant.'])
  assert.equal(sealed.model.providerID, 'anthropic')
  assert.equal(sealed.model.modelID, 'claude-3-5-sonnet')
  assert.equal(sealed.model.variant, 'high')
  assert.equal(sealed.toolsCaptured, false, 'progressive capture marks toolsCaptured false')
  assert.equal(sealed.nativePayload, null, 'progressive capture has null nativePayload')
})

test('SPEC[pair-hint-016] OutboundViewStore: re-entering a component resets pending state before sealing', () => {
  const store = new OutboundViewStore()
  const sid = 'sess-reenter-01'

  // First record messages & system
  store.recordSystem(sid, ['System prompt 1'])
  store.recordMessagesFor(sid, [{ info: { role: 'user', sessionID: sid }, content: 'msg 1' }])

  // Re-record system (should reset messages)
  store.recordSystem(sid, ['System prompt 2'])

  // Now record model - messages is now missing because pending was reset!
  store.recordModel(sid, { providerID: 'p1', modelID: 'm1' })
  assert.equal(store.tryGetSealed(sid), undefined, 're-entering component must reset pending and wait for full set')

  // Provide messages again
  store.recordMessagesFor(sid, [{ info: { role: 'user', sessionID: sid }, content: 'msg 2' }])
  const sealed = store.tryGetSealed(sid)
  assert.ok(sealed, 'should seal once full set arrives again')
  assert.deepEqual(sealed.system, ['System prompt 2'])
})

test('SPEC[pair-hint-016] OutboundViewStore: recordNativeRequest seals atomically with toolsCaptured=true', () => {
  const store = new OutboundViewStore()
  const sid = 'sess-native-01'

  const nativePayload = {
    messages: [{ role: 'user', content: 'run tool' }],
    tools: [{ type: 'function', function: { name: 'bash' } }],
    system: ['Execute instructions.']
  }
  const model = { providerID: 'openai', modelID: 'gpt-4o', variant: null }

  const ok = store.recordNativeRequest(sid, nativePayload, model)
  assert.equal(ok, true, 'complete native payload must be accepted')

  const sealed = store.tryGetSealed(sid)
  assert.ok(sealed)
  assert.equal(sealed.sessionId, sid)
  assert.equal(sealed.toolsCaptured, true, 'native capture must set toolsCaptured=true')
  assert.ok(sealed.nativePayload, 'native payload must be preserved')
  assert.deepEqual(sealed.system, ['Execute instructions.'])
  assert.equal(sealed.model.providerID, 'openai')
  assert.equal(sealed.model.modelID, 'gpt-4o')
  assert.equal(sealed.model.variant, null)
})

test('SPEC[pair-hint-016] OutboundViewStore: recordNativeRequest rejects defective or incomplete payloads', () => {
  const store = new OutboundViewStore()
  const sid = 'sess-native-reject'

  // Missing tools
  const noTools = { messages: [{ role: 'user', content: 'test' }], system: 'sys' }
  const ok1 = store.recordNativeRequest(sid, noTools, { providerID: 'p', modelID: 'm' })
  assert.equal(ok1, false)
  assert.equal(store.tryGetSealed(sid), undefined)

  // Empty messages
  const emptyMsgs = { messages: [], tools: [{}], system: 'sys' }
  const ok2 = store.recordNativeRequest(sid, emptyMsgs, { providerID: 'p', modelID: 'm' })
  assert.equal(ok2, false)

  // Missing model provider
  const validPayload = { messages: [{ role: 'user', content: 'hi' }], tools: [{}], system: 'sys' }
  const ok3 = store.recordNativeRequest(sid, validPayload, { providerID: '', modelID: 'm' })
  assert.equal(ok3, false)
})

test('SPEC[pair-hint-016] OutboundViewStore: cloneDeep isolates internal state from external mutation', () => {
  const store = new OutboundViewStore()
  const sid = 'sess-clone-01'

  const msgs = [{ info: { role: 'user', sessionID: sid }, content: 'original' }]
  store.recordSystem(sid, ['sys'])
  store.recordModel(sid, { providerID: 'p', modelID: 'm' })
  store.recordMessagesFor(sid, msgs)

  // Mutate original array and object
  msgs[0].content = 'MUTATED'
  msgs.push({ info: { role: 'user', sessionID: sid }, content: 'NEW' })

  const sealed = store.tryGetSealed(sid)
  assert.ok(sealed)
  assert.equal(sealed.messages[0].content, 'original', 'sealed snapshot must not reflect mutation to original input')
  assert.equal(sealed.messages.length, 1)
})

test('SPEC[pair-hint-016] OutboundViewStore: discardSealed empties sealed snapshot in single-drain semantics', () => {
  const store = new OutboundViewStore()
  const sid = 'sess-drain-01'

  store.recordSystem(sid, ['sys'])
  store.recordModel(sid, { providerID: 'p', modelID: 'm' })
  store.recordMessagesFor(sid, [{ info: { role: 'user', sessionID: sid }, content: 'hi' }])
  assert.ok(store.tryGetSealed(sid))

  store.discardSealed(sid)
  assert.equal(store.tryGetSealed(sid), undefined, 'discardSealed must clear sealed state')

  // Calling discardSealed again is idempotent
  store.discardSealed(sid)
  assert.equal(store.tryGetSealed(sid), undefined)
})

test('SPEC[pair-hint-016] OutboundViewStore: clearSession purges both pending and sealed records', () => {
  const store = new OutboundViewStore()
  const sid = 'sess-clear-01'

  store.recordSystem(sid, ['sys'])
  store.clearSession(sid)

  // Recording model and messages now won't seal because system was wiped
  store.recordModel(sid, { providerID: 'p', modelID: 'm' })
  store.recordMessagesFor(sid, [{ info: { role: 'user', sessionID: sid }, content: 'hi' }])
  assert.equal(store.tryGetSealed(sid), undefined, 'clearSession must have discarded prior pending system')
})

test('SPEC[pair-hint-016] OutboundViewStore: serializeSnapshot produces exact JSON contract', () => {
  const store = new OutboundViewStore()
  const sid = 'sess-json-01'

  const payload = {
    messages: [{ role: 'user', content: 'test payload' }],
    tools: [{ name: 'read' }],
    system: ['system text']
  }
  store.recordNativeRequest(sid, payload, { providerID: 'anthropic', modelID: 'claude-3-haiku', variant: 'fast' })
  const snapshot = store.tryGetSealed(sid)
  assert.ok(snapshot)

  const jsonStr = store.serializeSnapshot(snapshot)
  const parsed = JSON.parse(jsonStr)

  assert.equal(parsed.sessionId, sid)
  assert.deepEqual(parsed.system, ['system text'])
  assert.equal(parsed.toolsCaptured, true)
  assert.equal(parsed.model.providerID, 'anthropic')
  assert.equal(parsed.model.modelID, 'claude-3-haiku')
  assert.equal(parsed.model.variant, 'fast')
  assert.ok(parsed.nativePayload)
  assert.deepEqual(parsed.messages, [{ role: 'user', content: 'test payload' }])
})

test('SPEC[pair-hint-016] OutboundViewStore & PairHint: serialized snapshot is consumable by startTemporaryFromFrozen', () => {
  const store = new OutboundViewStore()
  const hint = PairHint()
  const sid = 'sess-e2e-01'
  const tempId = 'temp-sess-01'

  store.recordNativeRequest(sid, {
    messages: [{ role: 'user', content: 'consult' }],
    tools: [{ name: 't1' }],
    system: ['frozen sys']
  }, { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' })

  const snapshot = store.tryGetSealed(sid)
  const jsonStr = store.serializeSnapshot(snapshot)
  const parsed = JSON.parse(jsonStr)

  const res = hint.startTemporaryFromFrozen(tempId, parsed)
  assert.equal(res.ok, true, 'startTemporaryFromFrozen must accept snapshot serialized by OutboundViewStore')
  assert.equal(hint.isTemporary(tempId), true)
  hint.finishTemporary(tempId)
  assert.equal(hint.isTemporary(tempId), false)
})

test('SPEC[pair-hint-016] OutboundViewStore: global singleton outboundViewStore is exported and operational', () => {
  assert.ok(outboundViewStore instanceof OutboundViewStore)
  const sid = 'sess-singleton-01'
  outboundViewStore.recordSystem(sid, ['s'])
  outboundViewStore.clearSession(sid)
})
