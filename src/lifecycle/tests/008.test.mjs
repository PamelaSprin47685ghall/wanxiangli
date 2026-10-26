import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RootWorkspaceCell,
  rootWorkspaceCell,
  SharedEventStorePool,
  sharedEventStorePool,
  SharedAsyncJournalPool,
  sharedAsyncJournalPool,
} from 'wanxiangli/work'

test('SPEC[lifecycle-008] RootWorkspaceCell 首次绑定成功、二次绑定被拒、空白字符串被拒', () => {
  const cell = new RootWorkspaceCell()
  assert.equal(cell.TryRead(), undefined)
  assert.equal(cell.tryRead(), null)

  // 空白字符串被拒
  assert.equal(cell.TryBind(''), false, '空字符串不能绑定')
  assert.equal(cell.TryBind('   \t\n'), false, '空白字符串不能绑定')
  assert.equal(cell.TryBind(null), false, 'null 不能绑定')
  assert.equal(cell.TryBind(undefined), false, 'undefined 不能绑定')
  assert.equal(cell.TryRead(), undefined)

  // 首次绑定成功
  assert.equal(cell.TryBind('/workspace/alpha'), true, '有效路径首次绑定应成功')
  assert.equal(cell.TryRead(), '/workspace/alpha')
  assert.equal(cell.tryRead(), '/workspace/alpha')

  // 二次绑定被拒
  assert.equal(cell.TryBind('/workspace/beta'), false, '已绑定后二次绑定应被拒')
  assert.equal(cell.TryRead(), '/workspace/alpha', '已绑定路径不应被修改')

  // 重置后可重新绑定
  cell.Clear()
  assert.equal(cell.TryRead(), undefined)
  assert.equal(cell.TryBind('/workspace/gamma'), true, 'Clear 后应能再次绑定')
  assert.equal(cell.TryRead(), '/workspace/gamma')

  // 全局单例验证
  assert.ok(rootWorkspaceCell instanceof RootWorkspaceCell)
})

test('SPEC[lifecycle-008] SharedEventStorePool 并发复用、计数增减、归零驱逐后重建', () => {
  const pool = new SharedEventStorePool()

  assert.throws(() => pool.Acquire('', () => ({})), /commonDir is empty/)
  assert.throws(() => pool.Acquire('   ', () => ({})), /commonDir is empty/)

  let factoryCalls = 0
  const createStore = dir => {
    factoryCalls += 1
    return { dir, id: `store-${factoryCalls}` }
  }

  // 首次获取
  const storeA1 = pool.Acquire('/common/repo-1', createStore)
  assert.equal(factoryCalls, 1)
  assert.equal(pool.SnapshotCount('/common/repo-1'), 1)
  assert.equal(pool.TryCurrent('/common/repo-1'), storeA1)

  // 二次获取复用现有实例
  const storeA2 = pool.Acquire('/common/repo-1', createStore)
  assert.equal(factoryCalls, 1, '命中现有实例时不应调用工厂')
  assert.equal(storeA1, storeA2, '应返回完全相同的引用')
  assert.equal(pool.SnapshotCount('/common/repo-1'), 2)

  // 独立目录互不干扰
  const storeB1 = pool.Acquire('/common/repo-2', createStore)
  assert.equal(factoryCalls, 2)
  assert.equal(pool.SnapshotCount('/common/repo-2'), 1)

  // 首次 release: 引用计数减为 1，不驱逐
  const evicted1 = pool.Release('/common/repo-1')
  assert.equal(evicted1, false, '计数减为 1 时不应驱逐')
  assert.equal(pool.SnapshotCount('/common/repo-1'), 1)
  assert.equal(pool.TryCurrent('/common/repo-1'), storeA1)

  // 二次 release: 引用计数归零，驱逐
  const evicted2 = pool.Release('/common/repo-1')
  assert.equal(evicted2, true, '计数归零时应驱逐')
  assert.equal(pool.SnapshotCount('/common/repo-1'), 0)
  assert.equal(pool.TryCurrent('/common/repo-1'), undefined)

  // 驱逐后重新获取，应触发工厂重建
  const storeA3 = pool.Acquire('/common/repo-1', createStore)
  assert.equal(factoryCalls, 3, '驱逐后重新获取应触发工厂')
  assert.notEqual(storeA3, storeA1)
  assert.equal(pool.SnapshotCount('/common/repo-1'), 1)

  // 未存在目录释放返回 false
  assert.equal(pool.Release('/common/non-existent'), false)
  assert.equal(pool.Release(''), false)

  // 单例验证
  assert.ok(sharedEventStorePool instanceof SharedEventStorePool)
})

test('SPEC[lifecycle-008] SharedAsyncJournalPool 打开失败自修剪、过期 ready 结算隔离、ReleaseTarget 引用同一性', () => {
  const pool = new SharedAsyncJournalPool()

  assert.throws(() => pool.AcquireOrStart('', () => Promise.resolve({})), /directory is empty/)

  let startCalls = 0
  const createReady = () => {
    startCalls += 1
    return { promiseId: startCalls }
  }

  // 1. 首次获取与复用
  const [ready1, isNew1] = pool.AcquireOrStart('/dir/alpha', createReady)
  assert.equal(isNew1, true)
  assert.equal(startCalls, 1)
  assert.equal(pool.SnapshotCount('/dir/alpha'), 1)

  const [ready2, isNew2] = pool.AcquireOrStart('/dir/alpha', createReady)
  assert.equal(isNew2, false)
  assert.equal(startCalls, 1, '复用时不重新触发 startReady')
  assert.equal(ready1, ready2)
  assert.equal(pool.SnapshotCount('/dir/alpha'), 2)

  // 2. 过期 readyTask 结算不生效
  const fakeReady = { promiseId: 999 }
  const realInstance = { name: 'journal-instance-1' }
  pool.SettleSuccess('/dir/alpha', fakeReady, realInstance)
  // 此时应当尚未设置 instance
  const releaseUnsettled = pool.ReleaseTarget(realInstance)
  assert.equal(releaseUnsettled, undefined, '由于 fakeReady 未匹配，Instance 尚未建立')

  // 3. 正确 readyTask 结算
  pool.SettleSuccess('/dir/alpha', ready1, realInstance)

  // 4. ReleaseTarget 引用同一性与计数递减
  const fakeInstance = { name: 'journal-instance-1' } // 内容相同但不同引用
  assert.equal(pool.ReleaseTarget(fakeInstance), undefined, '非同一引用的实例不能触发释放')
  assert.equal(pool.SnapshotCount('/dir/alpha'), 2)

  // 第一次释放目标：计数由 2 降至 1，不返回销毁实例
  const firstRelease = pool.ReleaseTarget(realInstance)
  assert.equal(firstRelease, undefined, '仍有引用时不返回待销毁实例')
  assert.equal(pool.SnapshotCount('/dir/alpha'), 1)

  // 第二次释放目标：计数归零，从 pool 移除并返回待销毁实例
  const secondRelease = pool.ReleaseTarget(realInstance)
  assert.equal(secondRelease, realInstance, '归零时应返回待销毁实例')
  assert.equal(pool.SnapshotCount('/dir/alpha'), 0)

  // 再次释放已驱逐的目标返回 undefined
  assert.equal(pool.ReleaseTarget(realInstance), undefined)

  // 5. 失败自修剪 (Fail-closed pruning)
  const [failReady, failIsNew] = pool.AcquireOrStart('/dir/fail', createReady)
  assert.equal(failIsNew, true)
  assert.equal(pool.SnapshotCount('/dir/fail'), 1)

  // 模拟打开失败并自修剪
  pool.SettleFailure('/dir/fail', failReady)
  assert.equal(pool.SnapshotCount('/dir/fail'), 0, 'SettleFailure 应将条目从字典移除')

  // 后续请求应重新触发创建
  const [retryReady, retryIsNew] = pool.AcquireOrStart('/dir/fail', createReady)
  assert.equal(retryIsNew, true, '自修剪后再次请求应重新触发 startReady')
  assert.notEqual(retryReady, failReady)

  // 验证单例
  assert.ok(sharedAsyncJournalPool instanceof SharedAsyncJournalPool)
})
