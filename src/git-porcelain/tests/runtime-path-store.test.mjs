import test from 'node:test'
import assert from 'node:assert/strict'

import { RuntimePathStore, runtimePathStore } from 'wanxiangli/git-porcelain'

test('SPEC[runtime-path-store-1] normalizeKey trims trailing slashes, preserves root, preserves drive letters and handles whitespace', () => {
  const store = new RuntimePathStore()

  // 普通路径尾部斜杠裁剪
  assert.equal(store.normalizeKey('/repo/path/'), '/repo/path')
  assert.equal(store.normalizeKey('/repo/path///'), '/repo/path')
  assert.equal(store.normalizeKey('C:\\repo\\path\\\\'), 'C:\\repo\\path')
  assert.equal(store.normalizeKey('repo/path/'), 'repo/path')

  // 纯斜杠根目录保护（不得变为空字符串）
  assert.equal(store.normalizeKey('/'), '/')
  assert.equal(store.normalizeKey('///'), '/')
  assert.equal(store.normalizeKey('\\'), '\\')
  assert.equal(store.normalizeKey('\\\\\\'), '\\')

  // Windows 盘符根目录保护
  assert.equal(store.normalizeKey('C:\\'), 'C:\\')
  assert.equal(store.normalizeKey('C:/'), 'C:/')

  // 空值与空白字符保留原边界行为
  assert.equal(store.normalizeKey(''), '')
  assert.equal(store.normalizeKey(null), '')
  assert.equal(store.normalizeKey(undefined), '')
  assert.equal(store.normalizeKey('   '), '   ')
})

test('SPEC[runtime-path-store-2] getOrCompute caches by normalized key; same path hits same cached promise', async () => {
  const store = new RuntimePathStore()
  let computeCount = 0

  const compute = (normalizedKey) => {
    computeCount++
    return Promise.resolve(`root-for-${normalizedKey}`)
  }

  const p1 = store.getOrCompute('/workspace/project', compute)
  const p2 = store.getOrCompute('/workspace/project/', compute)
  const p3 = store.getOrCompute('/workspace/project///', compute)

  assert.equal(computeCount, 1, 'compute should be called only once')
  assert.ok(Object.is(p1, p2), 'p1 and p2 must be identical promise instance')
  assert.ok(Object.is(p2, p3), 'p2 and p3 must be identical promise instance')
  assert.equal(store.has('/workspace/project'), true)
  assert.equal(store.has('/workspace/project/'), true)

  const val = await p1
  assert.equal(val, 'root-for-/workspace/project')
})

test('SPEC[runtime-path-store-3] invalidate removes specific cached workspace by normalized key', () => {
  const store = new RuntimePathStore()

  store.getOrCompute('/ws/a', () => 'val-a')
  store.getOrCompute('/ws/b', () => 'val-b')

  assert.equal(store.has('/ws/a/'), true)
  assert.equal(store.has('/ws/b/'), true)

  const removed = store.invalidate('/ws/a/')
  assert.equal(removed, true)
  assert.equal(store.has('/ws/a'), false)
  assert.equal(store.has('/ws/b'), true)

  const removedAgain = store.invalidate('/ws/a')
  assert.equal(removedAgain, false)
})

test('SPEC[runtime-path-store-4] clear empties all cached workspaces', () => {
  const store = new RuntimePathStore()

  store.getOrCompute('/ws/1', () => 'v1')
  store.getOrCompute('/ws/2', () => 'v2')
  assert.equal(store.has('/ws/1'), true)
  assert.equal(store.has('/ws/2'), true)

  store.clear()
  assert.equal(store.has('/ws/1'), false)
  assert.equal(store.has('/ws/2'), false)
})

test('SPEC[runtime-path-store-5] multi-instance isolation and singleton independence', () => {
  const storeA = new RuntimePathStore()
  const storeB = new RuntimePathStore()

  storeA.getOrCompute('/shared', () => 'from-a')
  assert.equal(storeA.has('/shared'), true)
  assert.equal(storeB.has('/shared'), false)

  assert.equal(runtimePathStore.has('/singleton-test-path'), false)
  runtimePathStore.getOrCompute('/singleton-test-path', () => 'from-singleton')
  assert.equal(runtimePathStore.has('/singleton-test-path'), true)
  assert.equal(storeA.has('/singleton-test-path'), false)

  // 清理单例中的测试项
  runtimePathStore.invalidate('/singleton-test-path')
  assert.equal(runtimePathStore.has('/singleton-test-path'), false)
})

test('SPEC[runtime-path-store-6] Promise rejection auto-cleans cache without deleting newer replacement (ABA prevention)', async () => {
  const store = new RuntimePathStore()

  // 1. 失败的 Promise 自动清理
  let failCount = 0
  const failPromise = store.getOrCompute('/fail-path', () => {
    failCount++
    return Promise.reject(new Error('git error'))
  })

  assert.equal(store.has('/fail-path'), true)

  try {
    await failPromise
    assert.fail('should have rejected')
  } catch (err) {
    assert.equal(err.message, 'git error')
  }

  // 确保微任务队列中的 catch 处理执行完毕
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(store.has('/fail-path'), false, 'failed promise should auto-evict from cache')

  // 下一次调用应当能够重新计算
  const successPromise = store.getOrCompute('/fail-path', () => 'success-val')
  assert.equal(successPromise, 'success-val')
  assert.equal(store.has('/fail-path'), true)

  // 2. ABA 预防：当旧 Promise 失败驱逐时，若槽位已被新 Promise/对象占用，不得误删新对象
  const oldFailed = Promise.reject(new Error('stale error'))
  oldFailed.catch(() => {}) // 避免未处理 rejection 告警

  const newSuccess = Promise.resolve('new-val')
  // 人工将新 Promise 放入槽位
  store.invalidate('/aba-path')
  store.getOrCompute('/aba-path', () => newSuccess)

  // 用旧的 oldFailed 调用 invalidate 进行 CAS 驱逐测试
  const evicted = store.invalidate('/aba-path', oldFailed)
  assert.equal(evicted, false, 'invalidate with mismatched expected object must return false')
  assert.equal(store.has('/aba-path'), true, 'new cache entry must remain intact')
})
