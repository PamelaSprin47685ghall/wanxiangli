import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AblationToolMapStore,
  ablationToolMapStore,
  AblationFactMapStore,
  ablationFactMapStore,
  AblationGateState,
  ablationGateState,
  AblationConfig,
  ablationConfig,
} from './support.mjs'

test('SPEC[ablation-004] AblationToolMapStore and AblationFactMapStore lazy cache and reset', () => {
  const toolMap = new AblationToolMapStore()
  let toolLoadCount = 0
  const toolLoader = () => {
    toolLoadCount++
    return [
      ['fork', 'delegation.async-fork'],
      ['skill', 'action-affordance'],
    ]
  }

  // 首次调用触发 loader
  assert.equal(toolMap.tryNode('fork', toolLoader), 'delegation.async-fork')
  assert.equal(toolLoadCount, 1)

  // 二次调用走缓存，不触发 loader
  assert.equal(toolMap.tryNode('skill', toolLoader), 'action-affordance')
  assert.equal(toolLoadCount, 1)

  // 查询未映射工具返回 null
  assert.equal(toolMap.tryNode('nonexistent-tool', toolLoader), null)
  assert.equal(toolLoadCount, 1)

  // resetCache 后再次调用重新触发 loader
  toolMap.resetCache()
  assert.equal(toolMap.tryNode('fork', toolLoader), 'delegation.async-fork')
  assert.equal(toolLoadCount, 2)

  // FactMap 同理
  const factMap = new AblationFactMapStore()
  let factLoadCount = 0
  const factLoader = () => {
    factLoadCount++
    return [['AgentFact.Delegation', 'delegation']]
  }
  assert.equal(factMap.tryNode('AgentFact.Delegation', factLoader), 'delegation')
  assert.equal(factLoadCount, 1)
  assert.equal(factMap.tryNode('AgentFact.Delegation', factLoader), 'delegation')
  assert.equal(factLoadCount, 1)
  factMap.resetCache()
  assert.equal(factMap.tryNode('AgentFact.Delegation', factLoader), 'delegation')
  assert.equal(factLoadCount, 2)
})

test('SPEC[ablation-004] AblationGateState manages registry and decides gates', () => {
  const gate = new AblationGateState()
  assert.equal(gate.installedRegistry(), null)

  const fallback = { name: 'fallback-reg' }
  let fallbackCalls = 0
  const fallbackLoader = () => {
    fallbackCalls++
    return fallback
  }

  // 1. 未安装时不污染 installedRegistry()
  assert.equal(gate.resolveRegistry(fallbackLoader), fallback)
  assert.equal(fallbackCalls, 1)
  assert.equal(gate.installedRegistry(), null)

  // 2. useRegistry 安装后返回已安装实例，不调用 fallback
  const custom = { name: 'custom-reg' }
  gate.useRegistry(custom)
  assert.equal(gate.installedRegistry(), custom)
  assert.equal(gate.resolveRegistry(fallbackLoader), custom)
  assert.equal(fallbackCalls, 1)

  // 3. resetRegistry 恢复未安装状态
  gate.resetRegistry()
  assert.equal(gate.installedRegistry(), null)
  assert.equal(gate.resolveRegistry(fallbackLoader), fallback)
  assert.equal(fallbackCalls, 2)

  // 4. 门禁判定
  const modes = { 'node-ablated': 'ablated', 'node-borrowed': 'borrowed', 'node-active': 'active' }
  const modeOf = (n) => modes[n] || 'active'
  const toolMap = { 'tool-a': 'node-ablated', 'tool-b': 'node-borrowed', 'tool-c': 'node-active' }
  const tryTool = (t) => toolMap[t] || null

  assert.equal(gate.toolDenied(modeOf, tryTool, 'tool-a'), true)
  assert.equal(gate.toolDenied(modeOf, tryTool, 'tool-b'), false)
  assert.equal(gate.toolDenied(modeOf, tryTool, 'tool-c'), false)
  assert.equal(gate.toolDenied(modeOf, tryTool, 'tool-unmapped'), false)

  assert.equal(gate.toolSchemaDenied(modeOf, tryTool, 'tool-a'), true)
  assert.equal(gate.toolSchemaDenied(modeOf, tryTool, 'tool-b'), false)
  assert.equal(gate.toolSchemaDenied(modeOf, tryTool, 'tool-c'), false)
  assert.equal(gate.toolSchemaDenied(modeOf, tryTool, 'tool-unmapped'), false)

  const factMap = { 'fact-a': 'node-ablated', 'fact-c': 'node-active' }
  const tryFact = (f) => factMap[f] || null
  assert.equal(gate.factDenied(modeOf, tryFact, 'fact-a'), true)
  assert.equal(gate.factDenied(modeOf, tryFact, 'fact-c'), false)
  assert.equal(gate.factDenied(modeOf, tryFact, 'fact-unmapped'), false)

  // primaryAgentAllowed
  const activeNodes = new Set(['work'])
  const isActive = (n) => activeNodes.has(n)
  assert.equal(gate.primaryAgentAllowed(isActive, 'manager'), true)
  assert.equal(gate.primaryAgentAllowed(isActive, 'orchestrator'), false)
  assert.equal(gate.primaryAgentAllowed(isActive, 'inquiry'), false)
  assert.equal(gate.primaryAgentAllowed(isActive, 'browser'), false)
  assert.equal(gate.primaryAgentAllowed(isActive, 'other-agent'), true)

  // fissionVisible
  assert.equal(gate.fissionVisible(isActive), false)
  activeNodes.add('intra-participant-parallelism')
  assert.equal(gate.fissionVisible(isActive), true)
})

test('SPEC[ablation-004] AblationConfig parses profile and overrides', () => {
  const config = new AblationConfig()

  // envKeyForNode
  assert.equal(config.envKeyForNode('delegation.async-fork'), 'WANXIANGSHU_ABLATION_delegation_async_fork')
  assert.equal(config.envKeyForNode('Feature-Ablation'), 'WANXIANGSHU_ABLATION_feature_ablation')

  // resolveProfile
  const env1 = { 'WANXIANGSHU_ABLATION_PROFILE': '  station-14  ' }
  assert.equal(config.resolveProfile((k) => env1[k]), 'station-14')
  assert.equal(config.resolveProfile(() => '   '), null)
  assert.equal(config.resolveProfile(() => null), null)

  // resolveOverrides: 合法三态与空白忽略
  const env2 = {
    'WANXIANGSHU_ABLATION_node_a': 'ablated',
    'WANXIANGSHU_ABLATION_node_b': '  borrowed ',
    'WANXIANGSHU_ABLATION_node_c': 'ACTIVE',
    'WANXIANGSHU_ABLATION_node_d': '',
  }
  const resOk = config.resolveOverrides(['node-a', 'node-b', 'node-c', 'node-d', 'node-e'], (k) => env2[k])
  assert.equal(resOk.ok, true)
  assert.deepEqual(resOk.pairs, [
    ['node-a', 'ablated'],
    ['node-b', 'borrowed'],
    ['node-c', 'active'],
  ])

  // resolveOverrides: 非法值返回 Error
  const env3 = {
    'WANXIANGSHU_ABLATION_node_bad': 'invalid_mode',
  }
  const resErr = config.resolveOverrides(['node-bad'], (k) => env3[k])
  assert.equal(resErr.ok, false)
  assert.equal(resErr.node, 'node-bad')
  assert.equal(resErr.raw, 'invalid_mode')
})

test('SPEC[ablation-004] global singletons are isolated from new instances', () => {
  assert.ok(ablationGateState instanceof AblationGateState)
  assert.ok(ablationToolMapStore instanceof AblationToolMapStore)
  assert.ok(ablationFactMapStore instanceof AblationFactMapStore)
  assert.ok(ablationConfig instanceof AblationConfig)

  const freshGate = new AblationGateState()
  ablationGateState.useRegistry({ name: 'singleton-registry' })
  assert.equal(ablationGateState.installedRegistry()?.name, 'singleton-registry')
  assert.equal(freshGate.installedRegistry(), null)
  ablationGateState.resetRegistry()
})
