/**
 * wanxiangli/bayes — exact posterior over a finite discrete hypothesis set for Sphinx v2
 * (CUT-31 ②, WHAT[sphinx-v2-009/021/025/026]).
 *
 * Only qualified factors count; each must name a dependency group, cover every hypothesis and carry
 * a finite likelihood in [0,1]. Log-space product, log-sum-exp normalization, zero prior stays zero.
 * One observation id is one observation; different ids in one group keep the first and report the
 * rest as dropped. A posterior is model-relative: it is not an observed accuracy. Pure, no I/O.
 */

export interface Hypothesis { readonly key: string; readonly prior: number }

export interface Factor {
  readonly observationId: string
  readonly dependencyKey: string
  readonly likelihoods: Readonly<Record<string, number>>
  readonly qualified: boolean
}

export interface Posterior {
  readonly probabilities: Readonly<Record<string, number>>
  readonly logPartition: number
  readonly usedObservations: readonly string[]
  /** [observationId, reason] for every member dropped by the declared conservative rule. */
  readonly dropped: readonly (readonly [string, string])[]
}

export type ExactFault =
  | { readonly kind: 'TooFewHypotheses'; readonly count: number }
  | { readonly kind: 'BlankHypothesisKey' }
  | { readonly kind: 'DuplicateHypothesisKey'; readonly key: string }
  | { readonly kind: 'InvalidPrior'; readonly key: string }
  | { readonly kind: 'ZeroPriorMass' }
  | { readonly kind: 'BlankDependencyKey'; readonly semanticKey: string }
  | { readonly kind: 'NoQualifiedFactor' }
  | { readonly kind: 'UnknownHypothesisKey'; readonly semanticKey: string; readonly key: string }
  | { readonly kind: 'IncompleteLikelihood'; readonly semanticKey: string; readonly missingKey: string }
  | { readonly kind: 'InvalidLikelihood'; readonly semanticKey: string; readonly key: string }
  | { readonly kind: 'NonPositivePartition' }

export type BayesResult =
  | { readonly ok: true; readonly posterior: Posterior }
  | { readonly ok: false; readonly fault: ExactFault }

export declare class BayesLaw {
  constructor()
  readonly contractVersion: 1
  /** Throws on a structurally malformed argument; every semantic defect is a typed fault. */
  infer(hypotheses: readonly Hypothesis[], factors: readonly Factor[]): BayesResult
  /** A prior-only run: no new evidence, no convergence; same hypothesis-set contract as infer. */
  priorOnly(hypotheses: readonly Hypothesis[]): BayesResult
}
