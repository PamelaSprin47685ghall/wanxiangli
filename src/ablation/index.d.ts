/** 清单节点。`kind` 缺省为 `package`；`slice` 节点必须声明同包主节点为 `parent`。 */
export interface AblationNode {
  readonly id: string
  readonly package: string
  readonly kind?: string
  readonly parent?: string | null
}

/** 清单边。`kind` 缺省为 `station-order`；只有 `station-order` 与 `borrow` 参与环检测与三态约束。 */
export interface AblationEdge {
  readonly from: string
  readonly to: string
  readonly kind?: string
}

export type AblationMode = 'ablated' | 'borrowed' | 'active'

export interface AblationViolation {
  readonly kind: 'InvalidManifest' | 'DagViolation'
  readonly reason: string
}

export interface AblationMessages {
  /** 子节点父链与"每包恰一主节点"；返回第一处违约或 null。 */
  validateNodes(nodes: readonly AblationNode[]): AblationViolation | null
  /** station-order 与 borrow 两类边上的环；返回第一处违约或 null。 */
  findCycle(nodes: readonly AblationNode[], edges: readonly AblationEdge[]): AblationViolation | null
  /** 三态边约束；未列出的节点按 `ablated`。返回第一处违约或 null。 */
  validateModes(edges: readonly AblationEdge[], modes: Readonly<Record<string, AblationMode>>): AblationViolation | null
}

export function Ablation(): AblationMessages

export class AblationToolMapStore {
  resetCache(): void
  tryNode(toolName: string, loader: () => readonly (readonly [string, string])[]): string | null
}

export class AblationFactMapStore {
  resetCache(): void
  tryNode(factTag: string, loader: () => readonly (readonly [string, string])[]): string | null
}

export class AblationGateState {
  useRegistry(registry: unknown): void
  resetRegistry(): void
  installedRegistry(): unknown
  resolveRegistry(fallback: () => unknown): unknown

  readonly deniedFactPath: string
  toolDenied(modeOfNode: (node: string) => string, tryToolNode: (toolName: string) => string | null | undefined, toolName: string): boolean
  toolSchemaDenied(modeOfNode: (node: string) => string, tryToolNode: (toolName: string) => string | null | undefined, toolName: string): boolean
  factDenied(modeOfNode: (node: string) => string, tryFactNode: (factTag: string) => string | null | undefined, factTag: string): boolean
  primaryAgentAllowed(isActiveNode: (node: string) => boolean, agentName: string): boolean
  fissionVisible(isActiveNode: (node: string) => boolean): boolean
}

export interface ResolveOverridesSuccess {
  readonly ok: true
  readonly pairs: readonly (readonly [string, string])[]
}

export interface ResolveOverridesFailure {
  readonly ok: false
  readonly node: string
  readonly raw: string
}

export type ResolveOverridesOutcome = ResolveOverridesSuccess | ResolveOverridesFailure

export class AblationConfig {
  envKeyForNode(nodeId: string): string
  resolveProfile(readEnv: (name: string) => string): string | null
  resolveOverrides(nodeIds: readonly string[], readEnv: (name: string) => string): ResolveOverridesOutcome
}

export const ablationToolMapStore: AblationToolMapStore
export const ablationFactMapStore: AblationFactMapStore
export const ablationGateState: AblationGateState
export const ablationConfig: AblationConfig
