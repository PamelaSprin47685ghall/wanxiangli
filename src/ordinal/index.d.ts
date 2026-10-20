/**
 * wanxiangli/ordinal — ordinal likelihoods for Sphinx v2 (CUT-31 ①, WHAT[sphinx-v2-014/025]).
 *
 * Stable log-space pairwise likelihoods (BTL and tie-aware three-way softmax) and the directional
 * gradient; Plackett–Luce and MaxDiff ranking likelihoods; composite pairs of a ranked ballot; the
 * descriptive Borda baseline. Pure. No fitting, no design claims, no I/O.
 */

export type Theta = Readonly<Record<string, number>>

export declare class OrdinalLaw {
  constructor()
  readonly contractVersion: 1
  /** log(sigmoid(x)); finite for large |x|. */
  logSigmoid(x: number): number
  /** log(exp(a) + exp(b)) without exponentiating the larger term. */
  logSumExp(a: number, b: number): number
  /** logSigmoid(thetaWinner - thetaLoser + beta * position). */
  directionalLogLikelihood(thetaWinner: number, thetaLoser: number, beta: number, position: number): number
  /** softmax(eta/2, -eta/2, kappa) with eta = thetaLeft - thetaRight + beta * position. */
  tieAwareLogLikelihood(thetaLeft: number, thetaRight: number, beta: number, position: number, kappa: number, observedTie: boolean): number
  /** d log p / d(thetaWinner, thetaLoser, beta). */
  directionalGradient(thetaWinner: number, thetaLoser: number, beta: number, position: number): [number, number, number]
  /** null when theta is incomplete for the set. */
  maxDiffLogProbability(theta: Theta, set: readonly string[], best: string, worst: string): number | null
  /** null when the order is partial. */
  plackettLuceLogProbability(theta: Theta, order: readonly string[]): number | null
  /** Pairs (earlier, later) of one ranked ballot; the cluster must travel with them. */
  compositePairs(order: readonly string[]): [string, string][]
  /** Mean points per appearance (n - index); 0 when never shown. Descriptive only, never a likelihood. */
  bordaCounts(rankings: readonly (readonly string[])[], candidates: readonly string[]): Readonly<Record<string, number>>
}
