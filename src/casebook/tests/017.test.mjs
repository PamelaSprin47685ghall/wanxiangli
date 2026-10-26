import test from 'node:test'
import assert from 'node:assert/strict'

import { BookkeeperLedger, bookkeeperLedger } from '../../../dist/casebook/CasebookIndexLaw.js'

test('WHAT[knowledge-reuse-006] SPEC[bookkeeper-ledger-1]: 基础附着生命周期与只读快照防篡改', () => {
  const ledger = new BookkeeperLedger()
  assert.equal(ledger.isAttached('s-1'), false, '初始状态下未附着')
  assert.equal(ledger.txIdFor('s-1'), '', '初始状态下 txId 为空串')
  assert.equal(ledger.tryTxId('s-1'), undefined, '初始状态下 tryTxId 为 undefined')
  assert.equal(ledger.getAttachment('s-1'), null, '初始状态下 getAttachment 为 null')

  ledger.bind('s-1', 'tx-100', 'owner-session-1')
  assert.equal(ledger.isAttached('s-1'), true, 'bind 后变为附着状态')
  assert.equal(ledger.txIdFor('s-1'), 'tx-100', 'txIdFor 返回准确的 txId')
  assert.equal(ledger.tryTxId('s-1'), 'tx-100', 'tryTxId 返回准确的 txId')

  const att = ledger.getAttachment('s-1')
  assert.ok(att, '附着快照存在')
  assert.equal(att.txId, 'tx-100')
  assert.equal(att.ownerSessionId, 'owner-session-1')
  assert.equal(att.attachment, 'bookkeeper:tx-100')

  // 防御性拷贝验证：修改返回快照不污染内部状态
  att.txId = 'hacked'
  assert.equal(ledger.txIdFor('s-1'), 'tx-100', '外部修改快照不影响内部状态')

  ledger.unbind('s-1')
  assert.equal(ledger.isAttached('s-1'), false, 'unbind 后恢复未附着')
  assert.equal(ledger.txIdFor('s-1'), '', 'unbind 后 txId 归空')
  assert.equal(ledger.getAttachment('s-1'), null, 'unbind 后快照为 null')
})

test('WHAT[interaction-authority-018] SPEC[bookkeeper-ledger-2]: 单次消费门禁与参数防篡改（agent / text 不匹配拒绝且保留）', () => {
  const ledger = new BookkeeperLedger()
  ledger.bind('s-2', 'tx-200', 'owner-2')
  assert.equal(ledger.authorize('s-2', 'bookkeeper', 'prompt: summarize observations'), true, '已附着会话授权成功')

  // 反例 A: agent 不匹配
  assert.equal(ledger.tryConsume('s-2', 'wrong-agent', 'prompt: summarize observations'), false, 'agent 错误必须拒绝消费')
  // 反例 B: text 不匹配
  assert.equal(ledger.tryConsume('s-2', 'bookkeeper', 'prompt: wrong text'), false, 'text 错误必须拒绝消费')
  // 反例 C: 缺省/null 参数
  assert.equal(ledger.tryConsume('s-2', null, 'prompt: summarize observations'), false, 'null agent 必须拒绝')
  assert.equal(ledger.tryConsume('s-2', 'bookkeeper', undefined), false, 'undefined text 必须拒绝')

  // 正例: 严格精确匹配消费
  assert.equal(ledger.tryConsume('s-2', 'bookkeeper', 'prompt: summarize observations'), true, '精确匹配消费成功')

  // 反例 D: 单次消费防重放（one-shot）
  assert.equal(ledger.tryConsume('s-2', 'bookkeeper', 'prompt: summarize observations'), false, '已消费授权再次尝试必定拒绝')
})

test('WHAT[capability-enforcement-006] SPEC[bookkeeper-ledger-3]: 解绑 (unbind) 原子撤销授权（防止幽灵授权残留）', () => {
  const ledger = new BookkeeperLedger()
  ledger.bind('s-3', 'tx-300', 'owner-3')
  assert.equal(ledger.authorize('s-3', 'bookkeeper', 'prompt: pending run'), true)

  // 解绑会话
  ledger.unbind('s-3')
  assert.equal(ledger.isAttached('s-3'), false, '会话已解绑')

  // 尝试消费解绑前的授权：必须失败
  assert.equal(ledger.tryConsume('s-3', 'bookkeeper', 'prompt: pending run'), false, '解绑后授权已原子清空，拒绝消费')
})

test('WHAT[knowledge-reuse-006] SPEC[bookkeeper-ledger-4]: 重复绑定 (bind) 覆盖旧绑定并清空旧待办授权（防跨事务代际泄露）', () => {
  const ledger = new BookkeeperLedger()
  ledger.bind('s-4', 'tx-old', 'owner-4')
  assert.equal(ledger.authorize('s-4', 'bookkeeper', 'prompt: old transaction'), true)

  // 重新绑定为新事务
  ledger.bind('s-4', 'tx-new', 'owner-4')
  assert.equal(ledger.txIdFor('s-4'), 'tx-new', '绑定已更新为 tx-new')

  // 旧事务授权必须已失效
  assert.equal(ledger.tryConsume('s-4', 'bookkeeper', 'prompt: old transaction'), false, '新绑定覆盖后旧授权不可被消费')

  // 为新事务登记授权
  assert.equal(ledger.authorize('s-4', 'bookkeeper', 'prompt: new transaction'), true)
  assert.equal(ledger.tryConsume('s-4', 'bookkeeper', 'prompt: new transaction'), true, '新事务授权消费成功')
})

test('WHAT[knowledge-reuse-006] SPEC[bookkeeper-ledger-5]: 未附着会话拒绝登记授权', () => {
  const ledger = new BookkeeperLedger()
  assert.equal(ledger.isAttached('s-unattached'), false)

  assert.equal(ledger.authorize('s-unattached', 'bookkeeper', 'prompt: ghost'), false, '未附着会话的授权直接拒绝')
  assert.equal(ledger.tryConsume('s-unattached', 'bookkeeper', 'prompt: ghost'), false, '未附着会话无法被消费')
})

test('WHAT[knowledge-reuse-006] SPEC[bookkeeper-ledger-6]: 多会话强隔离性', () => {
  const ledger = new BookkeeperLedger()
  ledger.bind('s-a', 'tx-a', 'owner-a')
  ledger.bind('s-b', 'tx-b', 'owner-b')
  ledger.authorize('s-a', 'bookkeeper', 'prompt: a')
  ledger.authorize('s-b', 'bookkeeper', 'prompt: b')

  // 消费 s-a 不影响 s-b
  assert.equal(ledger.tryConsume('s-a', 'bookkeeper', 'prompt: a'), true)
  assert.equal(ledger.tryConsume('s-a', 'bookkeeper', 'prompt: a'), false)

  // s-b 仍可被正常消费
  assert.equal(ledger.tryConsume('s-b', 'bookkeeper', 'prompt: b'), true)

  // unbind s-a 不影响 s-b 的附着状态
  ledger.bind('s-a', 'tx-a2', 'owner-a')
  ledger.unbind('s-a')
  assert.equal(ledger.isAttached('s-a'), false)
  assert.equal(ledger.isAttached('s-b'), true)
})

test('WHAT[knowledge-reuse-006] SPEC[bookkeeper-ledger-7]: 实例隔离与全局单例可用性', () => {
  const inst1 = new BookkeeperLedger()
  const inst2 = new BookkeeperLedger()

  inst1.bind('s-inst', 'tx-1', 'owner-1')
  assert.equal(inst1.isAttached('s-inst'), true)
  assert.equal(inst2.isAttached('s-inst'), false, '不同实例完全隔离')

  inst1.clear()
  assert.equal(inst1.isAttached('s-inst'), false, 'clear 排空当前实例所有状态')

  // 全局单例 bookkeeperLedger 可用性
  assert.ok(bookkeeperLedger instanceof BookkeeperLedger, '单例存在且为 BookkeeperLedger 实例')
  bookkeeperLedger.clear()
  bookkeeperLedger.bind('s-singleton', 'tx-sg', 'owner-sg')
  assert.equal(bookkeeperLedger.isAttached('s-singleton'), true)
  assert.equal(bookkeeperLedger.txIdFor('s-singleton'), 'tx-sg')
  bookkeeperLedger.clear()
  assert.equal(bookkeeperLedger.isAttached('s-singleton'), false)
})
