import test from 'node:test'
import assert from 'node:assert/strict'

import { AttachmentLeaseRegistry, AttachmentSessions, attachmentLeaseRegistry } from 'wanxiangli/attachment-lease'

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

const ok = value => ({ ok: true, value })
const error = reason => ({ ok: false, error: reason })
const request = { owner: 'owner', kind: 'worker', agent: 'agent', directory: null }
const associatedRequest = { ...request, title: 'title', restoreHint: null }
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('AttachmentSessions shares establishment, keeps the resident agent, and isolates another owner', async () => {
  const registry = new AttachmentLeaseRegistry()
  const sessions = new AttachmentSessions(registry)
  const started = deferred()
  const release = deferred()
  const observed = []
  const created = []
  const linked = []
  const effects = {
    isUsable: () => true,
    observe: async input => { observed.push(input); return ok(null) },
    create: async input => {
      created.push(input)
      if (input.owner === 'owner') { started.resolve(); await release.promise }
      return ok(`${input.owner}-child`)
    },
    link: async input => { linked.push(input); return ok() },
  }
  const first = sessions.getOrCreate(request, effects)
  const second = sessions.getOrCreate({ ...request, agent: 'later-agent' }, effects)
  await started.promise
  assert.equal(registry.hasInFlight('owner', 'worker'), true)
  const independent = await sessions.getOrCreate({ ...request, owner: 'other' }, effects)
  assert.equal(independent.value.sessionId, 'other-child')
  release.resolve()
  const [initial, concurrent] = await Promise.all([first, second])
  assert.strictEqual(initial, concurrent)
  assert.deepEqual(initial, ok({ sessionId: 'owner-child', origin: 'Created', agent: 'agent' }))
  assert.deepEqual(await sessions.getOrCreate({ ...request, agent: 'new-agent' }, effects), initial)
  assert.deepEqual(observed, [
    { owner: 'owner', kind: 'worker', agent: 'agent' },
    { owner: 'other', kind: 'worker', agent: 'agent' },
  ])
  assert.deepEqual(created, [
    { owner: 'owner', agent: 'agent', directory: null },
    { owner: 'other', agent: 'agent', directory: null },
  ])
  assert.deepEqual(linked.map(item => item.owner), ['other', 'owner'])
  assert.equal(registry.inFlightCount(), 0)
  const rejected = new Error('usable failed')
  assert.throws(() => sessions.getOrCreate(request, { ...effects, isUsable() { throw rejected } }), candidate => candidate === rejected)
  assert.throws(() => sessions.tryFind('owner', 'worker', () => { throw rejected }), candidate => candidate === rejected)
})

for (const rejected of [false, true]) {
  test(`AttachmentSessions retains an observation ${rejected ? 'rejection' : 'error'} flight`, async () => {
    const registry = new AttachmentLeaseRegistry()
    const sessions = new AttachmentSessions(registry)
    const failure = new Error('observation rejected')
    let observations = 0
    const effects = {
      isUsable: () => true,
      observe: async () => { observations++; if (rejected) throw failure; return error('observation failed') },
      create: async () => assert.fail('observation did not allow creation'),
      link: async () => assert.fail('observation did not allow linking'),
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (rejected) await assert.rejects(sessions.getOrCreate(request, effects), candidate => candidate === failure)
      else assert.deepEqual(await sessions.getOrCreate(request, effects), error('observation failed'))
    }
    assert.equal(observations, 1)
    assert.equal(registry.hasInFlight('owner', 'worker'), true)
    assert.equal(sessions.tryFind('owner', 'worker', () => true), null)
  })
}

for (const rejected of [false, true]) {
  test(`AttachmentSessions clears a creation ${rejected ? 'rejection' : 'error'} flight after observation`, async () => {
    const registry = new AttachmentLeaseRegistry()
    const sessions = new AttachmentSessions(registry)
    const failure = new Error('creation rejected')
    let creations = 0
    const effects = {
      isUsable: () => true,
      observe: async () => ok(null),
      create: async () => { creations++; if (rejected) throw failure; return error('creation failed') },
      link: async () => assert.fail('creation did not allow linking'),
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (rejected) await assert.rejects(sessions.getOrCreate(request, effects), candidate => candidate === failure)
      else assert.deepEqual(await sessions.getOrCreate(request, effects), error('creation failed'))
      assert.equal(registry.hasInFlight('owner', 'worker'), false)
    }
    assert.equal(creations, 2)
  })
}

const associatedEffects = (log, overrides = {}) => ({
  list: async input => { log.push(['list', input]); return ok([]) },
  create: async input => { log.push(['create', input]); return ok('created-child') },
  abort: async input => { log.push(['abort', input]); return ok() },
  link: async input => { log.push(['link', input]); return ok() },
  close: async input => { log.push(['close', input]); return ok() },
  rejection: input => `${input.rejection}:${input.owner}:${input.kind}:${input.child}`,
  ...overrides,
})

const cleanupCases = [
  { origin: 'Replacement', step: 'close', rejected: false, abortRejected: false, expected: ['list', 'create', 'close', 'abort'] },
  { origin: 'Replacement', step: 'link', rejected: false, abortRejected: false, expected: ['list', 'create', 'close', 'link', 'abort'] },
  { origin: 'Created', step: 'link', rejected: false, abortRejected: true, expected: ['list', 'create', 'link', 'abort'] },
  { origin: 'Replacement', step: 'close', rejected: true, expected: ['list', 'create', 'close'] },
  { origin: 'Created', step: 'link', rejected: true, expected: ['list', 'create', 'link'] },
  { origin: 'Reused', step: 'link', rejected: false, expected: ['list', 'link'] },
  { origin: 'Reused', step: 'link', rejected: true, expected: ['list', 'link'] },
]
for (const scenario of cleanupCases) {
  test(`AttachmentSessions ${scenario.origin} ${scenario.step} ${scenario.rejected ? 'rejection' : 'error'} cleanup, abort rejects=${!!scenario.abortRejected}`, async () => {
    const registry = new AttachmentLeaseRegistry()
    const sessions = new AttachmentSessions(registry)
    const log = []
    const failure = new Error('operation rejected')
    const abortFailure = new Error('abort rejected')
    const effects = associatedEffects(log, {
      list: async input => {
        log.push(['list', input])
        return ok(scenario.origin === 'Reused' ? [{ sessionId: 'hint', agent: 'agent', title: 'title' }] : [])
      },
      [scenario.step]: async input => {
        log.push([scenario.step, input])
        if (scenario.rejected) throw failure
        return error('original error')
      },
      abort: async input => {
        log.push(['abort', input])
        if (scenario.abortRejected) throw abortFailure
        return error('ignored abort error')
      },
    })
    const pending = sessions.ensureAssociated({ ...associatedRequest, restoreHint: scenario.origin === 'Created' ? null : 'hint' }, effects)
    if (scenario.rejected) await assert.rejects(pending, candidate => candidate === failure)
    else if (scenario.abortRejected) await assert.rejects(pending, candidate => candidate === abortFailure)
    else assert.deepEqual(await pending, error('original error'))
    assert.deepEqual(log.map(([step]) => step), scenario.expected)
    assert.equal(registry.hasInFlight('owner', 'worker'), false)
    assert.equal(registry.tryFind('owner', 'worker'), undefined)
  })
}

test('AttachmentSessions preserves a replacement association and uses adapter rejection text', async () => {
  const registry = new AttachmentLeaseRegistry()
  const sessions = new AttachmentSessions(registry)
  const log = []
  const replaced = await sessions.ensureAssociated({ ...associatedRequest, restoreHint: 'gone' }, associatedEffects(log))
  assert.deepEqual(replaced, ok({ sessionId: 'created-child', origin: 'Replacement', agent: 'agent' }))
  assert.deepEqual(log.map(([step]) => step), ['list', 'create', 'close', 'link'])
  assert.deepEqual(log[3][1], { owner: 'owner', sessionId: 'created-child', agent: 'agent' })
  for (const children of [
    [{ sessionId: 'gone', agent: 'different', title: 'title' }],
    [{ sessionId: 'gone' }, { sessionId: 'gone' }],
  ]) {
    const effects = associatedEffects([], { list: async () => ok(children) })
    const result = await sessions.ensureAssociated({ ...associatedRequest, restoreHint: 'gone' }, effects)
    assert.deepEqual(result, error(`${children.length === 1 ? 'Conflicting' : 'Ambiguous'}:owner:worker:gone`))
    assert.equal(registry.tryFind('owner', 'worker').sessionId, 'created-child')
    assert.equal(registry.hasInFlight('owner', 'worker'), false)
  }
})

for (const failAt of ['none', 'errors', 'abort', 'close']) {
  test(`AttachmentSessions retirement keeps the existing cleanup order when ${failAt}`, async () => {
    const registry = new AttachmentLeaseRegistry()
    const sessions = new AttachmentSessions(registry)
    registry.bind('owner', 'worker', { sessionId: 'child', origin: 'Created', agent: 'agent' })
    const flight = {}
    registry.ensure('owner', 'worker', () => flight)
    const steps = []
    const failure = new Error(`${failAt} rejected`)
    const effects = {
      abort: async input => {
        assert.deepEqual(input, { sessionId: 'child' })
        steps.push('abort')
        if (failAt === 'abort') throw failure
        return failAt === 'errors' ? error('abort error') : ok()
      },
      close: async input => {
        assert.deepEqual(input, { owner: 'owner' })
        assert.equal(registry.tryFind('owner', 'worker').sessionId, 'child')
        assert.equal(registry.ensure('owner', 'worker', () => assert.fail('flight was removed early')), flight)
        steps.push('close')
        if (failAt === 'close') throw failure
        return failAt === 'errors' ? error('close error') : ok()
      },
    }
    const pending = sessions.retireAssociated('owner', 'worker', effects)
    if (failAt === 'abort' || failAt === 'close') {
      await assert.rejects(pending, candidate => candidate === failure)
      assert.equal(registry.tryFind('owner', 'worker').sessionId, 'child')
      assert.equal(registry.hasInFlight('owner', 'worker'), true)
    } else {
      assert.deepEqual(await pending, failAt === 'errors' ? error('abort error') : ok())
      assert.equal(registry.tryFind('owner', 'worker'), undefined)
      assert.equal(registry.hasInFlight('owner', 'worker'), false)
    }
    assert.deepEqual(steps, failAt === 'abort' ? ['abort'] : ['abort', 'close'])
  })
}

test('AttachmentSessions removes only requested bindings and closes an absent association after clearing its flight', async () => {
  const registry = new AttachmentLeaseRegistry()
  const sessions = new AttachmentSessions(registry)
  const lease = { sessionId: 'child', origin: 'Created', agent: 'agent' }
  registry.bind('owner', 'worker', lease)
  registry.bind('other', 'observer', lease)
  registry.ensure('owner', 'worker', () => ({}))
  assert.equal(sessions.tryFindOwner('child', 'observer'), 'other')
  assert.equal(sessions.tryFindOwner('child', 'missing'), null)
  assert.equal(sessions.tryFind('owner', 'worker', () => false), null)
  sessions.clearKinds(['worker'])
  assert.equal(registry.tryFind('owner', 'worker'), undefined)
  assert.equal(registry.hasInFlight('owner', 'worker'), true)
  assert.equal(registry.tryFind('other', 'observer').sessionId, 'child')
  assert.equal(sessions.removeByChild('child'), true)
  assert.equal(sessions.removeByChild('child'), false)
  assert.deepEqual(await sessions.retireAssociated('owner', 'worker', {
    abort: async () => assert.fail('no resident child'),
    close: async input => {
      assert.deepEqual(input, { owner: 'owner' })
      assert.equal(registry.hasInFlight('owner', 'worker'), false)
      return error('close failed')
    },
  }), error('close failed'))
})
