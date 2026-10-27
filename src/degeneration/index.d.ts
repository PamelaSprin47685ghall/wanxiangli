/**
 * wanxiangli/degeneration — per-session request-latency detection
 * (Gamma–Exponential posterior with right-censored observations)
 * plus the host reliability diagnostics counters.
 *
 * The detector never reads the clock: every duration is handed in by the caller.
 */

export interface LatencySnapshot {
  readonly SessionId: string
  readonly Observations: number
  readonly CompletedCount: number
  readonly CensoredCount: number
  /** Sum of the durations (completed and censored) currently inside the window. */
  readonly WindowMs: number
  readonly Alpha: number
  readonly Beta: number
  readonly MeanMs: number
  readonly ThresholdMs: number
  readonly Percentile: number
}

export declare class RequestLatencyDetector {
  constructor()
  /** Posterior 99% quantile (β/α)·ln(1/(1−Percentile)); no floor. Reading does not mutate state. */
  ThresholdMs(sessionId: string): number
  /** Posterior CDF 1 − exp(−(α/β)·elapsed). Reading does not mutate state. */
  Cdf(sessionId: string, elapsedMs: number): number
  ObserveCompleted(sessionId: string, durationMs: number): LatencySnapshot
  /** Right-censored observation: raises β only, never α. */
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
