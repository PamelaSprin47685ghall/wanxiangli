/**
 * wanxiangli/degeneration — per-session request-latency detection
 * (exponential model with right-censored observations, no prior, 100-observation novice protection)
 * plus the host reliability diagnostics counters.
 *
 * The detector never reads the clock: every duration is handed in by the caller.
 */

/**
 * Per-session state is three sufficient statistics plus a raw count (O(1) memory, no raw samples):
 * decayed completed count k, decayed censored count m, decayed total duration S, raw observations n.
 * Each observation multiplies k/m/S by γ = 0.98 before adding itself. No prior: Alpha = k, Beta = S.
 * Until n reaches 100 (novice protection) or while k = 0, ThresholdMs is +Infinity.
 * Observations / CompletedCount / CensoredCount / WindowMs are these decayed (possibly fractional) values.
 */
export interface LatencySnapshot {
  readonly SessionId: string
  readonly Observations: number
  /** Raw (undecayed) number of observations, completed and censored. */
  readonly Seen: number
  readonly CompletedCount: number
  readonly CensoredCount: number
  /** Decayed sum S of all durations (completed and censored). */
  readonly WindowMs: number
  readonly Alpha: number
  readonly Beta: number
  readonly MeanMs: number
  readonly ThresholdMs: number
  readonly Percentile: number
}

export declare class RequestLatencyDetector {
  constructor()
  /** 99% quantile (S/k)·ln(1/(1−Percentile)); +Infinity before 100 observations or without a completed sample; no floor. Reading does not mutate state. */
  ThresholdMs(sessionId: string): number
  /** CDF 1 − exp(−(k/S)·elapsed); 0 while there is no estimate. Reading does not mutate state. */
  Cdf(sessionId: string, elapsedMs: number): number
  ObserveCompleted(sessionId: string, durationMs: number): LatencySnapshot
  /** Right-censored observation: raises S only, never k. */
  ObserveCensored(sessionId: string, censoredMs: number): LatencySnapshot
  Snapshot(sessionId: string): LatencySnapshot
  Forget(sessionId: string): void
  Clear(): void
}

export declare function createRequestLatencyDetector(): RequestLatencyDetector
export declare const requestLatencyDetector: RequestLatencyDetector

export type ReliabilityObservationKind =
  | 'identityConflict'
  | 'queueFull'
  | 'fatalSettlement'
  | 'recovery:observeOnly'
  | 'recovery:resumeAdmission'
  | 'recovery:reconcileStartedProvider'
  | 'recovery:markTerminal'
  | 'recovery:failClosed'
  | 'recovery:manualIntervention'
  | 'hookFailure'
  | 'fallbackAdvanced'
  | 'streamAbort'

export interface ReliabilityCounterSnapshot {
  readonly identityConflicts: bigint
  readonly queueFull: bigint
  readonly fatalSettlements: bigint
  readonly recoveryObserveOnly: bigint
  readonly recoveryResumeAdmission: bigint
  readonly recoveryReconcileStartedProvider: bigint
  readonly recoveryMarkTerminal: bigint
  readonly recoveryFailClosed: bigint
  readonly recoveryManualIntervention: bigint
  readonly hookFailures: bigint
  readonly fallbackAdvances: bigint
  readonly streamAborts: bigint
}

export class ReliabilityDiagnosticsStore {
  constructor()
  Record(kind: ReliabilityObservationKind | string): void
  Snapshot(): ReliabilityCounterSnapshot
  Reset(): void
}

export class ReliabilityCounters extends ReliabilityDiagnosticsStore {}

export const reliabilityDiagnosticsStore: ReliabilityDiagnosticsStore
export const reliabilityCounters: ReliabilityCounters
export function createReliabilityDiagnosticsStore(): ReliabilityDiagnosticsStore
export function createReliabilityCounters(): ReliabilityCounters
