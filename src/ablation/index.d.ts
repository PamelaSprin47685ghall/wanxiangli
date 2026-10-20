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
