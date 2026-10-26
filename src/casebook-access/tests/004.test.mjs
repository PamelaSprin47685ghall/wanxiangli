import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AccessTracker,
  CasebookObservationCollector,
  casebookObservationCollector
} from 'wanxiangli/casebook-access'

test('Package-06 AccessTracker 纯内存路径收集与操作记录', () => {
  const tracker = new AccessTracker()

  tracker.RecordRead('src/foo.fs', 'hash123')
  tracker.RecordRead('src/bar.fs', 'hash456')
  // 忽略 contentHash，重复读同一路径
  tracker.RecordRead('src/foo.fs', 'differentHash')

  // grep 和 glob 不计入 relatedPaths
  tracker.RecordGrep('pattern', 'src/ignored.fs')
  tracker.RecordGlob('*.fs')

  // 未提交的 mutation 不计入
  tracker.RecordAttemptedMutation('src/uncommitted.fs', false)

  // 已提交的 mutation 计入
  tracker.RecordAttemptedMutation('src/committed.fs', true)

  const related = tracker.GetRelatedPaths()
  assert.deepEqual(related, ['src/bar.fs', 'src/committed.fs', 'src/foo.fs'])

  // recordMove 计入两端
  tracker.RecordMove('src/old.fs', 'src/new.fs')
  assert.deepEqual(tracker.GetRelatedPaths(), [
    'src/bar.fs',
    'src/committed.fs',
    'src/foo.fs',
    'src/new.fs',
    'src/old.fs'
  ])
})

test('Package-06 CasebookObservationCollector: 空输出不记录 buffer 但 tracker 仍记录访问', () => {
  const collector = new CasebookObservationCollector()
  const sid = 'sess-empty-output'

  // 空白 path 或空白 output 不记入 buffer
  collector.RecordFileRead(sid, '', 'valid-output')
  collector.RecordFileRead(sid, 'src/empty.fs', '')
  collector.RecordFileRead(sid, 'src/whitespace.fs', '   \n  ')
  assert.equal(collector.Count(sid), 0)

  // 即使 output 为空，tracker 仍然记录了非空 path 的读取
  const tracker = collector.getTracker(sid)
  assert.deepEqual(tracker.GetRelatedPaths(), ['src/empty.fs', 'src/whitespace.fs'])

  // 正常写入
  collector.RecordFileRead(sid, 'src/real.fs', 'hello world', 'shaReal')
  assert.equal(collector.Count(sid), 1)

  const drained = collector.Drain(sid)
  assert.deepEqual(drained, [
    { path: 'src/real.fs', contentHash: 'shaReal' }
  ])
})

test('Package-06 CasebookObservationCollector: Drain 清空 buffer 但严格保留 tracker', () => {
  const collector = new CasebookObservationCollector()
  const sid = 'sess-drain-keep-tracker'

  collector.RecordFileRead(sid, 'src/a.fs', 'aaa', 'hashA')
  collector.RecordFileRead(sid, 'src/b.fs', 'bbb', 'hashB')

  assert.equal(collector.Count(sid), 2)

  // 首次 Drain 返回所有观测并清空 buffer
  const firstDrain = collector.Drain(sid)
  assert.equal(firstDrain.length, 2)
  assert.equal(collector.Count(sid), 0)

  // 再次 Drain 返回空数组
  const secondDrain = collector.Drain(sid)
  assert.deepEqual(secondDrain, [])

  // 关键反例验证：清空 buffer 绝不能清空 tracker
  const tracker = collector.getTracker(sid)
  assert.deepEqual(tracker.GetRelatedPaths(), ['src/a.fs', 'src/b.fs'])
})

test('Package-06 CasebookObservationCollector: 重复观测去重并按 identity 升序排序', () => {
  const collector = new CasebookObservationCollector()
  const sid = 'sess-sort-dedupe'

  // 无序乱入、包含重复
  collector.RecordFileRead(sid, 'src/z.fs', 'z-content', 'hashZ')
  collector.RecordFileRead(sid, 'src/a.fs', 'a-content', 'hashA')
  collector.RecordFileRead(sid, 'src/m.fs', 'm-content', 'hashM')
  collector.RecordFileRead(sid, 'src/a.fs', 'a-content', 'hashA') // 完全相同 (path, hash)
  collector.RecordFileRead(sid, 'src/a.fs', 'a-other-content', 'hashA2') // 同 path 不同 hash

  assert.equal(collector.Count(sid), 5)

  const drained = collector.Drain(sid)
  // 按 "read:" + path + ":" + hash 码元序排序
  assert.deepEqual(drained, [
    { path: 'src/a.fs', contentHash: 'hashA' },
    { path: 'src/a.fs', contentHash: 'hashA2' },
    { path: 'src/m.fs', contentHash: 'hashM' },
    { path: 'src/z.fs', contentHash: 'hashZ' }
  ])
})

test('Package-06 CasebookObservationCollector: 会话隔离与多实例独立性', () => {
  const c1 = new CasebookObservationCollector()
  const c2 = new CasebookObservationCollector()

  c1.RecordFileRead('sess-1', 'src/c1.fs', 'content1', 'hash1')
  c2.RecordFileRead('sess-2', 'src/c2.fs', 'content2', 'hash2')

  // c1 和 c2 互不干扰
  assert.equal(c1.Count('sess-1'), 1)
  assert.equal(c1.Count('sess-2'), 0)
  assert.equal(c2.Count('sess-1'), 0)
  assert.equal(c2.Count('sess-2'), 1)

  // 同一 collector 内两个 session 互不干扰
  c1.RecordFileRead('sess-alt', 'src/alt.fs', 'content-alt', 'hash-alt')
  assert.equal(c1.Count('sess-1'), 1)
  assert.equal(c1.Count('sess-alt'), 1)

  const drained1 = c1.Drain('sess-1')
  assert.equal(drained1.length, 1)
  assert.equal(c1.Count('sess-1'), 0)
  assert.equal(c1.Count('sess-alt'), 1) // sess-alt 完好无损
})

test('Package-06 CasebookObservationCollector: Collect 只向 tracker 记变更，绝不污染 buffer', () => {
  const collector = new CasebookObservationCollector()
  const sid = 'sess-collect-tool'

  // create 工具调用
  collector.Collect(sid, 'create', { path: 'src/new-tool-file.fs' }, 'success')


  // buffer 仍然为 0
  assert.equal(collector.Count(sid), 0)
  assert.deepEqual(collector.Drain(sid), [])

  // tracker 中已准确记录已提交的变更
  const tracker = collector.getTracker(sid)
  assert.deepEqual(tracker.GetRelatedPaths(), ['src/new-tool-file.fs'])
})

test('Package-06 全局单例 casebookObservationCollector 存在且具备完整功能', () => {
  assert.ok(casebookObservationCollector instanceof CasebookObservationCollector)
  const sid = 'sess-singleton-test'
  casebookObservationCollector.RecordFileRead(sid, 'src/single.fs', 'text', 'hSingle')
  assert.equal(casebookObservationCollector.Count(sid), 1)
  const res = casebookObservationCollector.Drain(sid)
  assert.deepEqual(res, [{ path: 'src/single.fs', contentHash: 'hSingle' }])
})
