import test from 'node:test'
import assert from 'node:assert/strict'
import { DeliveryAttemptLedger, deliveryAttemptLedger } from 'wanxiangli/dispatch'

test('DeliveryAttemptLedger: 物理输入不匹配的陈旧见证被拒 (tryFindDurableEstablished)', () => {
  const ledger = new DeliveryAttemptLedger()
  const witnesses = [
    {
      sessionId: 'session-1',
      providerRun: 'run-1',
      callId: 'call-1',
      physicalUserMessageId: 'msg-old',
    },
  ]

  // 查询当前物理消息为 msg-new，陈旧见证 msg-old 必须被拒绝返回 undefined
  const found = ledger.tryFindDurableEstablished(witnesses, 'session-1', 'msg-new')
  assert.equal(found, undefined, 'stale witness with mismatched physicalUserMessageId must be rejected')
})

test('DeliveryAttemptLedger: 最新匹配见证胜出 (tryFindDurableEstablished)', () => {
  const ledger = new DeliveryAttemptLedger()
  const witnesses = [
    {
      sessionId: 'session-1',
      providerRun: 'run-1',
      callId: 'call-first',
      physicalUserMessageId: 'msg-matching',
    },
    {
      sessionId: 'session-1',
      providerRun: 'run-2',
      callId: 'call-latest',
      physicalUserMessageId: 'msg-matching',
    },
  ]

  const found = ledger.tryFindDurableEstablished(witnesses, 'session-1', 'msg-matching')
  assert.ok(found, 'matching witness should be found')
  assert.equal(found.sessionId, 'session-1')
  assert.equal(found.providerRun, 'run-2')
  assert.equal(found.callId, 'call-latest', 'latest matching witness must win')
})

test('DeliveryAttemptLedger: 重复记录不重复完成，已有物理围栏不可被改写', () => {
  const ledger = new DeliveryAttemptLedger()
  const fence = {
    sessionId: 'session-1',
    providerRun: 'run-1',
    callId: 'call-1',
  }

  // 首次登记成立，记录物理输入 msg-initial
  const ok1 = ledger.recordEstablished(fence, 'msg-initial')
  assert.equal(ok1, true)

  const found1 = ledger.tryFindEstablished('session-1', 'msg-initial')
  assert.ok(found1)
  assert.equal(found1.established, true)
  assert.equal(found1.physical, 'msg-initial')

  // 二次登记传入不同物理输入 msg-modified，不得篡改最初物理围栏
  const ok2 = ledger.recordEstablished(fence, 'msg-modified')
  assert.equal(ok2, true)

  const foundPreserved = ledger.tryFindEstablished('session-1', 'msg-initial')
  assert.ok(foundPreserved, 'original physical fence must be preserved')
  assert.equal(foundPreserved.physical, 'msg-initial')

  const foundTampered = ledger.tryFindEstablished('session-1', 'msg-modified')
  assert.equal(foundTampered, undefined, 'tampered physical input must not match')
})

test('DeliveryAttemptLedger: 清空后 hasDurableEstablished 与 hasEstablished 为假', () => {
  const ledger = new DeliveryAttemptLedger()
  assert.equal(ledger.hasDurableEstablished([], 'session-1'), false)
  assert.equal(ledger.hasDurableEstablished(null, 'session-1'), false)

  ledger.recordEstablished({ sessionId: 'session-1', providerRun: 'run-1', callId: 'call-1' }, 'msg-1')
  assert.equal(ledger.hasEstablished('session-1'), true)

  ledger.clear()
  assert.equal(ledger.hasEstablished('session-1'), false)
  assert.equal(ledger.tryFindEstablished('session-1', 'msg-1'), undefined)
})

test('DeliveryAttemptLedger: 不同 ToolCallId 互不影响', () => {
  const ledger = new DeliveryAttemptLedger()
  const fenceA = { sessionId: 'session-1', providerRun: 'run-1', callId: 'call-A' }
  const fenceB = { sessionId: 'session-1', providerRun: 'run-1', callId: 'call-B' }

  ledger.recordEstablished(fenceA, 'msg-A')
  const taskA = { name: 'task-A' }
  ledger.recordInterruptIssued(fenceA, taskA)

  const factsA = ledger.interruptFacts(fenceA)
  assert.equal(factsA.issued, true)

  const factsB = ledger.interruptFacts(fenceB)
  assert.equal(factsB.issued, false, 'call-B interrupt must not be affected by call-A')

  // dropSession 清除 session-1 下的所有 call
  ledger.dropSession('session-1')
  assert.equal(ledger.hasEstablished('session-1'), false)
  assert.equal(ledger.interruptFacts(fenceA).issued, false)
})

test('DeliveryAttemptLedger: 畸形输入进门校验严格 fail-closed 且不污染内部状态', () => {
  const ledger = new DeliveryAttemptLedger()

  // 1. 非对象或 null fence
  assert.equal(ledger.recordEstablished(null, 'msg-1'), false)
  assert.equal(ledger.recordEstablished(12345, 'msg-1'), false)
  assert.equal(ledger.recordEstablished('not-an-object', 'msg-1'), false)

  // 2. 缺少必要字段的 fence
  assert.equal(ledger.recordEstablished({ sessionId: 's1' }, 'msg-1'), false)
  assert.equal(ledger.recordEstablished({ sessionId: 's1', providerRun: 'r1' }, 'msg-1'), false)
  assert.equal(ledger.recordEstablished({ sessionId: '', providerRun: 'r1', callId: 'c1' }, 'msg-1'), false)
  assert.equal(ledger.recordEstablished({ sessionId: '   ', providerRun: 'r1', callId: 'c1' }, 'msg-1'), false)

  // 3. 空白或空对象 physical 绝不转为 '[object Object]' 脏值
  assert.equal(ledger.recordEstablished({ sessionId: 's1', providerRun: 'r1', callId: 'c1' }, {}), true)
  const emptyPhysRecord = ledger.tryFindEstablished('s1', null)
  assert.ok(emptyPhysRecord)
  assert.equal(emptyPhysRecord.physical, undefined, 'empty object must not produce string physical fence')

  // 4. recordPresented / recordInterruptIssued / recordInterruptObserved 遇畸形 fence 均 fail-closed
  assert.equal(ledger.recordPresented(null), false)
  assert.equal(ledger.recordPresented({}), false)
  assert.equal(ledger.recordInterruptIssued(null, {}), false)
  assert.equal(ledger.recordInterruptObserved(null, {}), false)

  // 5. 畸形 witness 在 tryFindDurableEstablished 与 hasDurableEstablished 中安全被拒
  const malformedWitnesses = [null, 123, 'str', {}, { sessionId: 's1' }]
  assert.equal(ledger.tryFindDurableEstablished(malformedWitnesses, 's1', 'msg-1'), undefined)
  assert.equal(ledger.hasDurableEstablished(malformedWitnesses, 's1'), false)
})

test('DeliveryAttemptLedger: 同 run 多个 callId 各持中断任务时按 sequence 最新胜出', () => {
  const ledger = new DeliveryAttemptLedger()
  const fence1 = { sessionId: 'session-run', providerRun: 'run-alpha', callId: 'call-early' }
  const fence2 = { sessionId: 'session-run', providerRun: 'run-alpha', callId: 'call-late' }

  const taskEarly = { name: 'taskEarly', id: 1 }
  const taskLate = { name: 'taskLate', id: 2 }

  // 依次登记两个不同 callId 的中断任务
  ledger.recordInterruptIssued(fence1, taskEarly)
  ledger.recordInterruptIssued(fence2, taskLate)

  // activeInterruptTask 查找同一 session + providerRun 时，必须按 sequence 最新选取 taskLate
  const selectedTask = ledger.activeInterruptTask('session-run', 'run-alpha')
  assert.equal(selectedTask, taskLate, 'latest sequence task must win over earlier callId task')

  // 再次对 fence1 发出新中断，使 fence1 的 sequence 递增更新
  const taskReissued = { name: 'taskReissued', id: 3 }
  ledger.recordInterruptIssued(fence1, taskReissued)

  const newlySelected = ledger.activeInterruptTask('session-run', 'run-alpha')
  assert.equal(newlySelected, taskReissued, 'most recently issued task must win when sequence is updated')
})

test('DeliveryAttemptLedger: 独立实例与全局单例相互隔离', () => {
  const instance = new DeliveryAttemptLedger()
  const fence = { sessionId: 'session-iso', providerRun: 'run-iso', callId: 'call-iso' }

  instance.recordEstablished(fence, 'msg-iso')
  assert.equal(instance.hasEstablished('session-iso'), true)
  assert.equal(deliveryAttemptLedger.hasEstablished('session-iso'), false, 'singleton must be isolated from instance')
  instance.clear()
})
