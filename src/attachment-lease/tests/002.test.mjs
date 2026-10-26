import test from 'node:test'
import assert from 'node:assert/strict'

import { AttachmentLeaseRegistry, attachmentLeaseRegistry } from 'wanxiangli/attachment-lease'

test('SPEC[attachment-lease-2] bind / tryFind / remove 基本生命周期与同键覆写', () => {
  const reg = new AttachmentLeaseRegistry()

  // 初始查找不存在
  assert.equal(reg.tryFind('owner-1', 'companion'), undefined)

  // 绑定租约
  reg.bind('owner-1', 'companion', {
    sessionId: 'child-1',
    origin: 'Created',
    agent: 'companion',
  })

  const found = reg.tryFind('owner-1', 'companion')
  assert.ok(found)
  assert.equal(found.sessionId, 'child-1')
  assert.equal(found.origin, 'Created')
  assert.equal(found.agent, 'companion')
  assert.equal(found.owner, 'owner-1')
  assert.equal(found.kind, 'companion')

  // 同键覆写
  reg.bind('owner-1', 'companion', {
    sessionId: 'child-2',
    origin: 'Reused',
    agent: 'companion-v2',
  })

  const updated = reg.tryFind('owner-1', 'companion')
  assert.ok(updated)
  assert.equal(updated.sessionId, 'child-2')
  assert.equal(updated.origin, 'Reused')
  assert.equal(updated.agent, 'companion-v2')

  // 移除
  assert.equal(reg.remove('owner-1', 'companion'), true)
  assert.equal(reg.remove('owner-1', 'companion'), false)
  assert.equal(reg.tryFind('owner-1', 'companion'), undefined)
})

test('SPEC[attachment-lease-2] 含特殊分隔符的 kind（如 bookkeeper\u001ftx-1）在 snapshot、tryFindByChild、removeByChild 中无损还原', () => {
  const reg = new AttachmentLeaseRegistry()
  const specialKind = 'bookkeeper\u001ftx-123'

  reg.bind('owner-bk', specialKind, {
    sessionId: 'child-bk',
    origin: 'Created',
    agent: 'bookkeeper',
  })

  // snapshot 完整无损保留 kind
  const snap = reg.snapshot()
  assert.equal(snap.length, 1)
  assert.deepEqual(snap[0], { owner: 'owner-bk', kind: specialKind })

  // tryFindByChild 反向查得无损 kind
  const foundByChild = reg.tryFindByChild('child-bk')
  assert.equal(foundByChild.length, 1)
  assert.deepEqual(foundByChild[0], { owner: 'owner-bk', kind: specialKind })

  // removeByChild 移除并无损返回
  const removed = reg.removeByChild('child-bk')
  assert.equal(removed.length, 1)
  assert.deepEqual(removed[0], { owner: 'owner-bk', kind: specialKind })

  // 确认已注销
  assert.equal(reg.tryFind('owner-bk', specialKind), undefined)
  assert.equal(reg.snapshot().length, 0)
})

test('SPEC[attachment-lease-2] 同一个 childSessionId 绑定到多个 (owner, kind) 时，tryFindByChild 与 removeByChild 完整返回且彻底删除', () => {
  const reg = new AttachmentLeaseRegistry()
  const child = 'shared-child-xyz'

  reg.bind('owner-a', 'sync-coder', { sessionId: child, origin: 'Created', agent: 'coder' })
  reg.bind('owner-b', 'sync-inspector', { sessionId: child, origin: 'Reused', agent: 'inspector' })
  reg.bind('owner-c', 'companion', { sessionId: 'other-child', origin: 'Created', agent: 'companion' })

  const matches = reg.tryFindByChild(child)
  assert.equal(matches.length, 2)
  assert.deepEqual(matches, [
    { owner: 'owner-a', kind: 'sync-coder' },
    { owner: 'owner-b', kind: 'sync-inspector' },
  ])

  // removeByChild 彻底清理匹配项，不影响无关子会话
  const removed = reg.removeByChild(child)
  assert.equal(removed.length, 2)
  assert.deepEqual(removed, [
    { owner: 'owner-a', kind: 'sync-coder' },
    { owner: 'owner-b', kind: 'sync-inspector' },
  ])

  assert.equal(reg.tryFind('owner-a', 'sync-coder'), undefined)
  assert.equal(reg.tryFind('owner-b', 'sync-inspector'), undefined)
  assert.ok(reg.tryFind('owner-c', 'companion'))
  assert.equal(reg.snapshot().length, 1)
})

test('SPEC[attachment-lease-2] ensure 单飞复用：首次调用触发 start 并缓存返回句柄，第二次同键调用返回同一引用，不同键互不阻塞', async () => {
  const reg = new AttachmentLeaseRegistry()
  let callCount1 = 0
  let callCount2 = 0

  const p1 = Promise.resolve({ sessionId: 'child-1' })
  const p2 = Promise.resolve({ sessionId: 'child-2' })

  // 同键首次调用
  const flight1a = reg.ensure('owner-1', 'companion', () => {
    callCount1 += 1
    return p1
  })

  // 同键第二次调用：不应触发第二个 start，且返回完全相同的对象引用
  const flight1b = reg.ensure('owner-1', 'companion', () => {
    callCount1 += 1
    return Promise.resolve({ sessionId: 'child-ghost' })
  })

  assert.equal(callCount1, 1)
  assert.equal(flight1a, p1)
  assert.equal(flight1b, p1)
  assert.equal(reg.hasInFlight('owner-1', 'companion'), true)
  assert.equal(reg.inFlightCount(), 1)

  // 不同键：独立启动
  const flight2 = reg.ensure('owner-2', 'companion', () => {
    callCount2 += 1
    return p2
  })

  assert.equal(callCount2, 1)
  assert.equal(flight2, p2)
  assert.equal(reg.inFlightCount(), 2)

  const [res1, res2] = await Promise.all([flight1a, flight2])
  assert.deepEqual(res1, { sessionId: 'child-1' })
  assert.deepEqual(res2, { sessionId: 'child-2' })
})

test('SPEC[attachment-lease-2] finishEnsure 释放后再次 ensure 重新触发 start', () => {
  const reg = new AttachmentLeaseRegistry()
  let calls = 0

  const firstObj = { step: 1 }
  const secondObj = { step: 2 }

  const res1 = reg.ensure('owner-1', 'companion', () => {
    calls += 1
    return firstObj
  })
  assert.equal(calls, 1)
  assert.equal(res1, firstObj)
  assert.equal(reg.hasInFlight('owner-1', 'companion'), true)

  // 释放单飞
  reg.finishEnsure('owner-1', 'companion')
  assert.equal(reg.hasInFlight('owner-1', 'companion'), false)
  assert.equal(reg.inFlightCount(), 0)

  // 再次调用重新触发 start
  const res2 = reg.ensure('owner-1', 'companion', () => {
    calls += 1
    return secondObj
  })
  assert.equal(calls, 2)
  assert.equal(res2, secondObj)
})

test('SPEC[attachment-lease-2] clear 同时清空 bindings 与 flights，多实例与全局单例互相隔离', () => {
  const reg1 = new AttachmentLeaseRegistry()
  const reg2 = new AttachmentLeaseRegistry()

  reg1.bind('owner-1', 'companion', { sessionId: 'c-1', origin: 'Created', agent: 'a-1' })
  reg1.ensure('owner-1', 'companion', () => ({ flight: 1 }))

  // reg2 和全局单例不受影响
  assert.equal(reg2.snapshot().length, 0)
  assert.equal(reg2.inFlightCount(), 0)
  assert.equal(attachmentLeaseRegistry.snapshot().length, 0)
  assert.equal(attachmentLeaseRegistry.inFlightCount(), 0)

  // reg1 清理
  reg1.clear()
  assert.equal(reg1.snapshot().length, 0)
  assert.equal(reg1.inFlightCount(), 0)
  assert.equal(reg1.tryFind('owner-1', 'companion'), undefined)
  assert.equal(reg1.hasInFlight('owner-1', 'companion'), false)

  // 输入参数格式防御性拒绝
  assert.throws(() => reg1.bind(null, 'k', {}), /malformed owner/)
  assert.throws(() => reg1.bind('o', null, {}), /malformed kind/)
  assert.throws(() => reg1.bind('o', 'k', null), /malformed lease/)
  assert.throws(() => reg1.bind('o', 'k', { sessionId: 123 }), /malformed lease.sessionId/)
})
