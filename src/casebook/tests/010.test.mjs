import test from 'node:test'
import assert from 'node:assert/strict'

import { SessionDraftStore, sessionDraftStore } from 'wanxiangli/casebook'

test('SessionDraftStore — 独立实例与单例相互隔离', () => {
  const custom = new SessionDraftStore()
  custom.setQ('s-isolated', 'custom question')
  
  assert.equal(sessionDraftStore.tryTake('s-isolated'), undefined, '全局单例不应含有独立实例中的草稿')
  const snap = custom.tryTake('s-isolated')
  assert.ok(snap, '独立实例应能正常取出草稿')
  assert.equal(snap.turns.length, 1)
  assert.equal(snap.turns[0].Q, 'custom question')
})

test('SessionDraftStore — setQ 未答覆写与已答追加反例', () => {
  const store = new SessionDraftStore()
  
  // 1. 首轮 setQ
  store.setQ('s1', 'Q1-initial')
  // 2. 未回答再次 setQ -> 原地覆写
  store.setQ('s1', 'Q1-overwritten')
  
  let snap = store.tryTake('s1')
  assert.ok(snap)
  assert.equal(snap.turns.length, 1, '未答覆写时轮次不应增加')
  assert.equal(snap.turns[0].Q, 'Q1-overwritten')
  assert.equal(snap.turns[0].A, undefined)

  // 重新放入草稿并回答
  store.setQ('s1', 'Q1-final')
  store.setA('s1', 'A1-answer')

  // 已回答后再次 setQ -> 追加新轮
  store.setQ('s1', 'Q2-new')
  snap = store.tryTake('s1')
  assert.ok(snap)
  assert.equal(snap.turns.length, 2, '已答后 setQ 应追加新轮次')
  assert.equal(snap.turns[0].Q, 'Q1-final')
  assert.equal(snap.turns[0].A, 'A1-answer')
  assert.equal(snap.turns[1].Q, 'Q2-new')
  assert.equal(snap.turns[1].A, undefined)
})

test('SessionDraftStore — setA 空草稿补空Q与末轮覆写反例', () => {
  const store = new SessionDraftStore()

  // 1. 空草稿直接 setA -> 产生 Q="" 轮次
  store.setA('s-empty', 'first answer')
  let snap = store.tryTake('s-empty')
  assert.ok(snap)
  assert.equal(snap.turns.length, 1)
  assert.equal(snap.turns[0].Q, '', '空草稿补入的 Q 应为空字符串')
  assert.equal(snap.turns[0].A, 'first answer')

  // 2. 有未答轮次 setA -> 填入答案
  store.setQ('s-override', 'Q1')
  store.setA('s-override', 'A1-v1')
  // 再次 setA -> 覆写最新答案
  store.setA('s-override', 'A1-v2')
  snap = store.tryTake('s-override')
  assert.ok(snap)
  assert.equal(snap.turns.length, 1)
  assert.equal(snap.turns[0].Q, 'Q1')
  assert.equal(snap.turns[0].A, 'A1-v2', '多次 setA 应始终覆写末轮答案')
})

test('SessionDraftStore — tryTake 原子消费与再次取出为 undefined', () => {
  const store = new SessionDraftStore()
  store.setQ('s-take', 'Q')
  store.setA('s-take', 'A')

  const snap1 = store.tryTake('s-take')
  assert.ok(snap1)
  assert.equal(snap1.turns.length, 1)

  const snap2 = store.tryTake('s-take')
  assert.equal(snap2, undefined, '再次 tryTake 必须返回 undefined')
})

test('SessionDraftStore — clear 会话隔离与幂等性', () => {
  const store = new SessionDraftStore()
  store.setQ('s-a', 'QA')
  store.setQ('s-b', 'QB')

  store.clear('s-a')
  assert.equal(store.tryTake('s-a'), undefined, '被 clear 的会话应为空')
  
  // 再次 clear 幂等
  assert.doesNotThrow(() => store.clear('s-a'))

  // s-b 未受影响
  const snapB = store.tryTake('s-b')
  assert.ok(snapB)
  assert.equal(snapB.turns[0].Q, 'QB')
})

test('SessionDraftStore — lastQuestion 与 lastAnswer 行为', () => {
  const store = new SessionDraftStore()
  
  // 空草稿快照
  const emptySnap = { turns: [] }
  assert.equal(store.lastQuestion(emptySnap), '')
  assert.equal(store.lastAnswer(emptySnap), undefined)

  // 多轮快照：第一轮有答，第二轮未答
  const multiSnap = {
    turns: [
      { Q: 'Q1', A: 'A1' },
      { Q: 'Q2', A: undefined }
    ]
  }
  assert.equal(store.lastQuestion(multiSnap), 'Q2', 'lastQuestion 应取最后一轮 Q')
  assert.equal(store.lastAnswer(multiSnap), 'A1', 'lastAnswer 应逆向查找首个非空回答')
})

test('SessionDraftStore — transcript 逐字格式化、未答空A与无末尾换行', () => {
  const store = new SessionDraftStore()
  
  const draft = {
    turns: [
      { Q: 'How to build?', A: 'Run node scripts/build.mjs' },
      { Q: 'What about dotnet?', A: undefined }
    ]
  }

  const expected = 'Q1 = How to build?\nA1 = Run node scripts/build.mjs\nQ2 = What about dotnet?\nA2 = '
  assert.equal(store.transcript(draft), expected, 'transcript 必须忠实原格式输出')

  // 空草稿
  assert.equal(store.transcript({ turns: [] }), '')
})

test('SessionDraftStore — 空字符串答案 Some "" 必须算已答且 lastAnswer 返回 ""', () => {
  const store = new SessionDraftStore()
  store.setQ('s-empty-ans', 'Q1')
  // 1. 设置空字符串答案
  store.setA('s-empty-ans', '')
  
  // 2. 再次 setQ 应追加新轮次，而不是覆写第 1 轮
  store.setQ('s-empty-ans', 'Q2')
  
  const snap = store.tryTake('s-empty-ans')
  assert.ok(snap)
  assert.equal(snap.turns.length, 2, '空字符串答案必须算已回答，后续 setQ 应追加第 2 轮')
  assert.equal(snap.turns[0].Q, 'Q1')
  assert.equal(snap.turns[0].A, '', 'A 必须是空字符串 ""')
  assert.equal(snap.turns[1].Q, 'Q2')
  assert.equal(snap.turns[1].A, undefined)

  // 3. lastAnswer 针对空字符串答案快照必须返回 ""，绝不能是 undefined
  const snapSingleEmpty = { turns: [{ Q: 'Q1', A: '' }] }
  assert.equal(store.lastAnswer(snapSingleEmpty), '', 'lastAnswer 遇到空串回答必须返回 "" 而非 undefined')
})

test('SessionDraftStore — 快照数组外改隔离：取出后的 turns 数组修改不污染后续或已记录状态', () => {
  const store = new SessionDraftStore()
  store.setQ('s-iso-snap', 'Initial Q')
  store.setA('s-iso-snap', 'Initial A')

  const snap = store.tryTake('s-iso-snap')
  assert.ok(snap)
  assert.equal(snap.turns.length, 1)

  // 尝试在外部修改快照中的 turns 属性
  snap.turns[0] = { Q: 'Mutated Q', A: 'Mutated A' }
  snap.turns.push({ Q: 'Injected Q', A: 'Injected A' })

  // 再次取出必定是 undefined（原子消费），新草稿重新生成
  store.setQ('s-iso-snap', 'New Q')
  const snap2 = store.tryTake('s-iso-snap')
  assert.ok(snap2)
  assert.equal(snap2.turns.length, 1)
  assert.equal(snap2.turns[0].Q, 'New Q')
  assert.equal(snap2.turns[0].A, undefined)
})
