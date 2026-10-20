/**
 * wanxiangli/run-witness — process-local exact provider-run observations (CUT-10 ⑥a).
 *
 * Which target a finished provider run used (single-consumption, latest run per session only),
 * the exact (session, physical user message) a provider run belongs to, and the
 * single-consumption recovery retry binding of a session. Targets are opaque and returned by reference.
 * Does not route, does not hold capacity, does not decide failures.
 */

export interface RunWitnessView<T> {
  readonly sessionId: string
  readonly target: T
}

export interface RunStepIdentity {
  readonly sessionId: string
  readonly physicalUserMessageId: string
}

export declare class ProviderRunWitness<T = unknown> {
  constructor()
  /** Retires the session's previous witness, then records this run's target. */
  remember(sessionId: string, providerRun: string, target: T): void
  /** Consumes the run's witness; null when unknown, taken or retired. */
  take(providerRun: string): RunWitnessView<T> | null
  /** Consumes the run's witness; binds the retry only when it belongs to sessionId. */
  retainForRetry(sessionId: string, providerRun: string): T | null
  /** Consumes the session's retry binding once. */
  takeRetry(sessionId: string): T | null
  rememberStep(sessionId: string, physicalUserMessageId: string, providerRun: string): void
  stepOf(providerRun: string): RunStepIdentity | null
  /** Latest witness, retry binding and every run → physical relation of the session. */
  forgetSession(sessionId: string): void
  /** Only the run → physical relations of this exact physical execution. */
  forgetPhysical(sessionId: string, physicalUserMessageId: string): void
  snapshot(): { readonly witnesses: number; readonly latest: number; readonly steps: number; readonly retries: number }
}
