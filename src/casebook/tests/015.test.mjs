import test from 'node:test'
import assert from 'node:assert/strict'

import { FetchFlightRegistry, fetchFlightRegistry } from '../../../dist/casebook/CasebookIndexLaw.js'

test('FetchFlightRegistry — 并发同 (workspaceRoot, shelfmark) 且同一 storeToken 引用共享单飞，工厂只执行 1 次', async () => {
  const registry = new FetchFlightRegistry()
  const storeToken = { id: 'store-1' }
  let factoryCalls = 0

  let resolveFlight
  const factory = () => {
    factoryCalls += 1
    return new Promise((resolve) => {
      resolveFlight = resolve
    })
  }

  const p1 = registry.getOrCreate('/ws/root', 'shelf-alpha', storeToken, factory)
  const p2 = registry.getOrCreate('/ws/root', 'shelf-alpha', storeToken, factory)

  assert.equal(factoryCalls, 1, '工厂函数应仅被调用一次')
  assert.equal(registry.activeCount(), 1, '活跃单飞计数应为 1')
  assert.equal(p1, p2, '两次调用必须返回同一个 Promise 实例引用')

  resolveFlight('content-alpha')
  const [res1, res2] = await Promise.all([p1, p2])
  assert.equal(res1, 'content-alpha')
  assert.equal(res2, 'content-alpha')
  assert.equal(registry.activeCount(), 0, '完成结算后活跃计数自动归零')
})

test('FetchFlightRegistry — 在途期间传入不同 storeToken 引用，同步抛出 Casebook fetch flight store binding mismatch', async () => {
  const registry = new FetchFlightRegistry()
  const store1 = { id: 'store-1' }
  const store2 = { id: 'store-2' }

  let resolveFlight
  const p1 = registry.getOrCreate('/ws/root', 'shelf-beta', store1, () => new Promise((resolve) => {
    resolveFlight = resolve
  }))

  assert.equal(registry.activeCount(), 1)

  assert.throws(
    () => {
      registry.getOrCreate('/ws/root', 'shelf-beta', store2, () => Promise.resolve('should-not-run'))
    },
    /Casebook fetch flight store binding mismatch/
  )

  resolveFlight('done')
  await p1
  assert.equal(registry.activeCount(), 0)
})

test('FetchFlightRegistry — 正常 resolve 后条目自动移除，activeCount 归零，后续调用重新触发工厂并可绑定新 storeToken', async () => {
  const registry = new FetchFlightRegistry()
  const store1 = { id: 'store-1' }
  const store2 = { id: 'store-2' }
  let factoryCalls = 0

  const res1 = await registry.getOrCreate('/ws/root', 'shelf-gamma', store1, async () => {
    factoryCalls += 1
    return 'first-result'
  })
  assert.equal(res1, 'first-result')
  assert.equal(factoryCalls, 1)
  assert.equal(registry.activeCount(), 0)

  // 完成后再次请求：允许使用新 storeToken，并重新调用 factory
  const res2 = await registry.getOrCreate('/ws/root', 'shelf-gamma', store2, async () => {
    factoryCalls += 1
    return 'second-result'
  })
  assert.equal(res2, 'second-result')
  assert.equal(factoryCalls, 2)
  assert.equal(registry.activeCount(), 0)
})

test('FetchFlightRegistry — 工厂异步 reject 或同步 throw 后条目自动移除，不留孤儿锁', async () => {
  const registry = new FetchFlightRegistry()
  const store = { id: 'store' }

  // 1. 同步 throw
  assert.throws(
    () => {
      registry.getOrCreate('/ws/root', 'shelf-err-sync', store, () => {
        throw new Error('sync-failure')
      })
    },
    /sync-failure/
  )
  assert.equal(registry.activeCount(), 0, '同步抛错后不应残留活跃记录')

  // 同步抛错后后续调用能够正常发起
  const afterSync = await registry.getOrCreate('/ws/root', 'shelf-err-sync', store, async () => 'recovered')
  assert.equal(afterSync, 'recovered')
  assert.equal(registry.activeCount(), 0)

  // 2. 异步 reject
  let rejectFlight
  const pReject = registry.getOrCreate('/ws/root', 'shelf-err-async', store, () => new Promise((_, reject) => {
    rejectFlight = reject
  }))
  assert.equal(registry.activeCount(), 1)
  rejectFlight(new Error('async-failure'))

  await assert.rejects(pReject, /async-failure/)
  assert.equal(registry.activeCount(), 0, '异步 reject 结算后活跃计数自动归零')

  // 异步失败后后续调用能够正常发起
  const afterAsync = await registry.getOrCreate('/ws/root', 'shelf-err-async', store, async () => 'recovered-async')
  assert.equal(afterAsync, 'recovered-async')
  assert.equal(registry.activeCount(), 0)
})

test('FetchFlightRegistry — 在途期间手动 remove 或 clear 后新建同 key 请求，旧请求的延迟完成回调因 flightToken 不匹配不会误删新请求的在途条目', async () => {
  const registry = new FetchFlightRegistry()
  const store = { id: 'store' }

  let resolveFlight1
  let resolveFlight2

  const p1 = registry.getOrCreate('/ws/root', 'shelf-replace', store, () => new Promise((resolve) => {
    resolveFlight1 = resolve
  }))
  assert.equal(registry.activeCount(), 1)

  // 手动移除在途请求
  const removed = registry.remove('/ws/root', 'shelf-replace')
  assert.equal(removed, true)
  assert.equal(registry.activeCount(), 0)

  // 新建同 key 的在途请求 flight 2
  const p2 = registry.getOrCreate('/ws/root', 'shelf-replace', store, () => new Promise((resolve) => {
    resolveFlight2 = resolve
  }))
  assert.equal(registry.activeCount(), 1)

  // flight 1 延迟完成
  resolveFlight1('res-1')
  await p1

  // 关键断言：flight 1 的 finally 不得误删 flight 2
  assert.equal(registry.activeCount(), 1, '旧请求延迟结算不得误删新请求的在途注册')

  // flight 2 完成
  resolveFlight2('res-2')
  await p2
  assert.equal(registry.activeCount(), 0, '新请求完成后活跃计数正常归零')
})

test('FetchFlightRegistry — 不同 workspaceRoot 或不同 shelfmark（含包含分隔符字符的边界输入）互不阻塞', async () => {
  const registry = new FetchFlightRegistry()
  const store = { id: 'store' }

  // 1. 不同 shelfmark
  let resolveA, resolveB
  const pA = registry.getOrCreate('/ws', 'shelf-A', store, () => new Promise(r => { resolveA = r }))
  const pB = registry.getOrCreate('/ws', 'shelf-B', store, () => new Promise(r => { resolveB = r }))
  assert.equal(registry.activeCount(), 2)
  resolveA('A')
  resolveB('B')
  await Promise.all([pA, pB])
  assert.equal(registry.activeCount(), 0)

  // 2. 长度定界防碰撞验证："a\u0000b", "c" 与 "a", "b\u0000c"
  let resolveColl1, resolveColl2
  const pColl1 = registry.getOrCreate('a\u0000b', 'c', store, () => new Promise(r => { resolveColl1 = r }))
  const pColl2 = registry.getOrCreate('a', 'b\u0000c', store, () => new Promise(r => { resolveColl2 = r }))

  assert.equal(registry.activeCount(), 2, '包含分隔符的键经长度前缀定界后不应发生哈希碰撞')
  resolveColl1('coll-1')
  resolveColl2('coll-2')
  const [c1, c2] = await Promise.all([pColl1, pColl2])
  assert.equal(c1, 'coll-1')
  assert.equal(c2, 'coll-2')
  assert.equal(registry.activeCount(), 0)
})

test('FetchFlightRegistry — 全局单例 fetchFlightRegistry 与独立实例隔离且 clear 有效', async () => {
  const custom = new FetchFlightRegistry()
  const store = { id: 'store' }

  let resolveCustom
  custom.getOrCreate('/custom', 'shelf', store, () => new Promise(r => { resolveCustom = r }))
  assert.equal(custom.activeCount(), 1)
  assert.equal(fetchFlightRegistry.activeCount(), 0, '全局单例与独立实例状态严格隔离')

  custom.clear()
  assert.equal(custom.activeCount(), 0, 'clear 应清空活跃记录')
  resolveCustom('done')
})

test('FetchFlightRegistry — factory 同步重入检测：同 storeToken 共享在途 token，不同 storeToken 抛出 binding mismatch', async () => {
  const registry = new FetchFlightRegistry()
  const store1 = { id: 'store-1' }
  const store2 = { id: 'store-2' }

  let innerFactoryCalled = false
  let resolveOuter

  // 1. 同步重入且同 storeToken：内层直接复用已占位的 token，内层 factory 不执行
  const pOuter = registry.getOrCreate('/ws/reentrant', 'shelf-re', store1, () => {
    const pInner = registry.getOrCreate('/ws/reentrant', 'shelf-re', store1, () => {
      innerFactoryCalled = true
      return Promise.resolve('inner-should-never-run')
    })
    assert.equal(registry.activeCount(), 1, '重入期间活跃计数仍为 1')
    return new Promise((resolve) => {
      resolveOuter = resolve
    })
  })

  assert.equal(innerFactoryCalled, false, '同 storeToken 同步重入时内层工厂不得被调用')
  resolveOuter('outer-ok')
  const res = await pOuter
  assert.equal(res, 'outer-ok')
  assert.equal(registry.activeCount(), 0, '完成后计数归零')

  // 2. 同步重入且不同 storeToken：内层直接抛出 Casebook fetch flight store binding mismatch
  let outerFailedWithMismatch = false
  try {
    await registry.getOrCreate('/ws/reentrant', 'shelf-mismatch', store1, () => {
      // 试图以不同 storeToken 重入
      registry.getOrCreate('/ws/reentrant', 'shelf-mismatch', store2, () => Promise.resolve('impossible'))
      return Promise.resolve('outer')
    })
  } catch (err) {
    if (/Casebook fetch flight store binding mismatch/.test(err?.message)) {
      outerFailedWithMismatch = true
    }
  }

  assert.equal(outerFailedWithMismatch, true, '同步重入不同 storeToken 必须抛出 binding mismatch')
  assert.equal(registry.activeCount(), 0, '抛错后活跃状态必须干净清理')
})
