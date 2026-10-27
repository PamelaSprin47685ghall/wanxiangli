import test from 'node:test'
import assert from 'node:assert/strict'
import { LiveHostConfigStore } from 'wanxiangli/capability'

test('SPEC[live-host-config-001] 初始 null config 拒绝：read 与 apply 均返回 structured refusal', () => {
  const nullStore = new LiveHostConfigStore(null)

  const readRes = nullStore.read(['any', 'path'])
  assert.equal(readRes.ok, false)
  assert.equal(readRes.error, 'the host supplied no config object')

  const applyRes = nullStore.apply([{ path: ['any', 'path'], value: true }])
  assert.equal(applyRes.ok, false)
  assert.equal(applyRes.error, 'the host supplied no config object')

  const undefStore = new LiveHostConfigStore(undefined)
  const readUndef = undefStore.read(['feature', 'flag'])
  assert.equal(readUndef.ok, false)
  assert.equal(readUndef.error, 'the host supplied no config object')

  const applyUndef = undefStore.apply([{ path: ['feature', 'flag'], value: 'active' }])
  assert.equal(applyUndef.ok, false)
  assert.equal(applyUndef.error, 'the host supplied no config object')
})

test('SPEC[live-host-config-002] Accept 热替换后原地生效：同一 store 实例由拒绝变为读取活配置', () => {
  const store = new LiveHostConfigStore(null)

  assert.equal(store.read(['feature', 'enabled']).ok, false)

  const liveConfig1 = {
    feature: {
      enabled: true,
      title: 'Initial Title'
    }
  }
  store.accept(liveConfig1)

  const readBool = store.read(['feature', 'enabled'])
  assert.equal(readBool.ok, true)
  assert.equal(readBool.found, true)
  assert.equal(readBool.kind, 'bool')
  assert.equal(readBool.value, true)

  const readText = store.read(['feature', 'title'])
  assert.equal(readText.ok, true)
  assert.equal(readText.found, true)
  assert.equal(readText.kind, 'text')
  assert.equal(readText.value, 'Initial Title')

  // 热替换为第二份活配置
  const liveConfig2 = {
    feature: {
      enabled: false,
      title: 'Updated Title'
    }
  }
  store.accept(liveConfig2)

  const readBool2 = store.read(['feature', 'enabled'])
  assert.equal(readBool2.ok, true)
  assert.equal(readBool2.value, false)

  const readText2 = store.read(['feature', 'title'])
  assert.equal(readText2.ok, true)
  assert.equal(readText2.value, 'Updated Title')
})

test('SPEC[live-host-config-003] 深层路径读写 Bool/Text 与自动创建中间节点', () => {
  const rootObj = {}
  const store = new LiveHostConfigStore(rootObj)

  const applyRes = store.apply([
    { path: ['subsystem', 'deep', 'flag'], kind: 'bool', value: true },
    { path: ['subsystem', 'deep', 'name'], kind: 'text', value: 'alpha' },
    { path: ['subsystem', 'other', 'switch'], value: false },
    { path: ['subsystem', 'other', 'description'], value: 'beta-text' }
  ])

  assert.equal(applyRes.ok, true)
  assert.equal(applyRes.hasGap, false)
  assert.deepEqual(applyRes.gapPath, [])
  assert.equal(applyRes.gapReason, '')

  // 验证底层原生对象被正确结构化写入
  assert.equal(rootObj.subsystem.deep.flag, true)
  assert.equal(rootObj.subsystem.deep.name, 'alpha')
  assert.equal(rootObj.subsystem.other.switch, false)
  assert.equal(rootObj.subsystem.other.description, 'beta-text')

  // 验证 store.read 读回
  const readDeepFlag = store.read(['subsystem', 'deep', 'flag'])
  assert.equal(readDeepFlag.ok, true)
  assert.equal(readDeepFlag.found, true)
  assert.equal(readDeepFlag.kind, 'bool')
  assert.equal(readDeepFlag.value, true)

  const readDeepName = store.read(['subsystem', 'deep', 'name'])
  assert.equal(readDeepName.ok, true)
  assert.equal(readDeepName.found, true)
  assert.equal(readDeepName.kind, 'text')
  assert.equal(readDeepName.value, 'alpha')

  // 未命中路径
  const notFound1 = store.read(['subsystem', 'deep', 'nonexistent'])
  assert.equal(notFound1.ok, true)
  assert.equal(notFound1.found, false)
  assert.equal(notFound1.kind, '')
  assert.equal(notFound1.value, null)

  const notFound2 = store.read(['nonexistent'])
  assert.equal(notFound2.ok, true)
  assert.equal(notFound2.found, false)

  const notFoundEmpty = store.read([])
  assert.equal(notFoundEmpty.ok, true)
  assert.equal(notFoundEmpty.found, false)
})

test('SPEC[live-host-config-004] 冻结对象拒绝写返回 refused 错误', () => {
  const frozenLeaf = Object.freeze({ immutableKey: true })
  const frozenConfig = Object.freeze({
    level1: frozenLeaf
  })
  const store = new LiveHostConfigStore(frozenConfig)

  // 试图覆写已有冻结属性
  const applyRes1 = store.apply([
    { path: ['level1', 'immutableKey'], value: false }
  ])
  assert.equal(applyRes1.ok, false)
  assert.match(applyRes1.error, /the host config rejected the write/)

  // 试图在冻结对象上新增属性
  const applyRes2 = store.apply([
    { path: ['level1', 'newKey'], value: 'forbidden' }
  ])
  assert.equal(applyRes2.ok, false)
  assert.match(applyRes2.error, /the host config rejected the write/)
})

test('SPEC[live-host-config-005] 写后读回不一致返回 gap', () => {
  // 模拟宿主通过 getter/setter 静默丢弃修改或拒绝生效
  const resistantConfig = {}
  let actualValue = 'original'
  Object.defineProperty(resistantConfig, 'silentRefuse', {
    get() { return actualValue },
    set(_newVal) {
      // 静默丢弃，不更新 actualValue
    },
    configurable: true,
    enumerable: true
  })

  const store = new LiveHostConfigStore(resistantConfig)
  const applyRes = store.apply([
    { path: ['silentRefuse'], kind: 'text', value: 'should-change' }
  ])

  assert.equal(applyRes.ok, true)
  assert.equal(applyRes.hasGap, true)
  assert.deepEqual(applyRes.gapPath, ['silentRefuse'])
  assert.equal(applyRes.gapReason, 'the host did not accept or preserve the configured setting')

  // 模拟类型篡改（预期 string 但读回为 number）
  const typeMutatingConfig = {}
  Object.defineProperty(typeMutatingConfig, 'corruptedType', {
    get() { return 42 },
    set(_newVal) {},
    configurable: true,
    enumerable: true
  })

  const store2 = new LiveHostConfigStore(typeMutatingConfig)
  const applyRes2 = store2.apply([
    { path: ['corruptedType'], value: 'expected-string' }
  ])

  assert.equal(applyRes2.ok, true)
  assert.equal(applyRes2.hasGap, true)
  assert.deepEqual(applyRes2.gapPath, ['corruptedType'])
  assert.equal(applyRes2.gapReason, 'the host did not accept or preserve the configured setting')
})
