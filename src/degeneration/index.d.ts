/** 包络由组合者从自己的语料派生后传入；本模块只校验并使用它。 */
export interface DegenerationEnvelope {
  readonly vocabularySize: number
  /** 每 token 的衰减系数，严格介于 0 与 1。 */
  readonly lambda: number
  /** 加权相异计数的先验起点。 */
  readonly normalWeightedDistinctCount: number
  readonly minimumWeightedDistinctCount: number
  readonly maximumWeightedDistinctCount: number
}

export type DegenerationState = 'Normal' | 'TooRepetitive' | 'TooRandom'

export interface DegenerationEvaluation {
  readonly state: DegenerationState
  readonly isAnomalous: boolean
  readonly weightedDistinctTokens: number
  readonly step: number
}

export interface DegenerationDetector {
  /** 推入一段已分词 token；整段先校验，坏 token 不改变统计。 */
  push(tokens: readonly number[]): DegenerationEvaluation
  evaluate(): DegenerationEvaluation
  /** 已见过的不同 token 数，上限为词表大小。 */
  trackedTokenCount(): number
  /** 回到先验：step 0、无已见 token。 */
  reset(): void
}

export interface DegenerationMessages {
  detector(): DegenerationDetector
  classify(weightedDistinctTokens: number): DegenerationState
  envelope(): DegenerationEnvelope
}

export function Degeneration(envelope: DegenerationEnvelope): DegenerationMessages
