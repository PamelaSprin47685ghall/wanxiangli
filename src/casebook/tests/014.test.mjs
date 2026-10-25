import test from "node:test"
import assert from "node:assert/strict"
import { CasebookIndex, casebookIndex } from "../../../dist/casebook/CasebookIndexLaw.js"

test("CasebookIndex: 初始状态为 null 且 invalidate 不抛出", () => {
  const idx = new CasebookIndex()
  assert.equal(idx.tryGet(), null)
  idx.invalidate()
  assert.equal(idx.tryGet(), null)
})

test("CasebookIndex: 首次成功冻结空集合产生 epoch = 0n 且 dirty 消除", () => {
  const idx = new CasebookIndex()
  const snap1 = idx.freeze([])
  assert.equal(snap1.epoch === 0n || snap1.epoch === 0, true)
  assert.deepEqual(snap1.cases, [])

  // 再次 freeze 空集合：因条目未变且 dirty = false，epoch 不推进
  const snap2 = idx.freeze([])
  assert.equal(snap2.epoch, snap1.epoch)
})

test("CasebookIndex: invalidate 强制下次 freeze 推进 epoch", () => {
  const idx = new CasebookIndex()
  const snap1 = idx.freeze([])
  idx.invalidate()
  const snap2 = idx.freeze([])
  assert.equal(BigInt(snap2.epoch), BigInt(snap1.epoch) + 1n)
})

test("CasebookIndex: 案例内容或顺序变化推进 epoch", () => {
  const idx = new CasebookIndex()
  const c1 = [{ sessionId: "s1", question: "How to compile?" }]
  const c2 = [{ sessionId: "s1", question: "How to compile?" }, { sessionId: "s2", question: "How to test?" }]
  
  const snap1 = idx.freeze(c1)
  const snap2 = idx.freeze(c2)
  assert.equal(BigInt(snap2.epoch), BigInt(snap1.epoch) + 1n)
  assert.equal(snap2.cases.length, 2)

  // 同集合无变化：不推进 epoch
  const snap3 = idx.freeze(c2)
  assert.equal(BigInt(snap3.epoch), BigInt(snap2.epoch))
})

test("CasebookIndex: 快照防御性浅拷贝，外部修改不污染内部状态", () => {
  const idx = new CasebookIndex()
  const cases = [{ sessionId: "s1", question: "Safe Question" }]
  const snap = idx.freeze(cases)
  
  // 外部修改 snap.cases 数组
  snap.cases.push({ shelfmark: "fake", question: "fake" })
  
  // 再次 tryGet，内部条目不受外部 push 影响
  const snapAgain = idx.tryGet()
  assert.equal(snapAgain.cases.length, 1)
  assert.equal(snapAgain.cases[0].question, "Safe Question")
})

test("CasebookIndex: 实例与单例严格状态隔离", () => {
  const idx1 = new CasebookIndex()
  const idx2 = new CasebookIndex()
  
  idx1.freeze([{ sessionId: "s1", question: "Q1" }])
  assert.notEqual(idx1.tryGet(), null)
  assert.equal(idx2.tryGet(), null)
  
  // 单例存在且独立
  assert.equal(typeof casebookIndex.freeze, "function")
  assert.equal(typeof casebookIndex.tryGet, "function")
  assert.equal(typeof casebookIndex.invalidate, "function")
})

test("CasebookIndex: locate 与 shelfmarkFor 行为确定性", () => {
  const idx = new CasebookIndex()
  const cases = [
    { sessionId: "s1", question: "First Case" },
    { sessionId: "s2", question: "Second Case" }
  ]
  const sm1 = idx.shelfmarkFor("s1", "First Case")
  assert.equal(typeof sm1, "string")
  assert.equal(sm1.includes("First Case"), true)

  const pos1 = idx.locate(cases, sm1)
  assert.equal(pos1, 0)

  const posNotFound = idx.locate(cases, "Nonexistent · 12345678")
  assert.equal(posNotFound, -1)
})
