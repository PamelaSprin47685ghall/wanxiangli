/**
 * wanxiangli/advisor — Dedicated advisor seat registry and settled provider run ledger.
 */

export interface FSharpResult<T, E> {
  readonly tag: 0 | 1;
  readonly fields: [T] | [E];
}

export interface SettledRunSnapshot {
  readonly count: number;
}

export interface SeatRegistrySnapshot {
  readonly seatsCount: number;
}

/**
 * Monotonic ledger mapping advisor child session ID -> last settled provider run identity.
 * Replays or duplicate terminals of prior settled runs are recognized as stale and refused.
 */
export declare class SettledRunLedger {
  constructor();
  recordSettled(childSessionId: string, providerRun: string): void;
  tryPriorRun(childSessionId: string): string | undefined;
  priorRun(childSessionId: string): string;
  hasSettledRun(childSessionId: string): boolean;
  isStale(childSessionId: string, candidateRun: string): boolean;
  clearSession(childSessionId: string): void;
  clearAll(): void;
  snapshot(): SettledRunSnapshot;
}

export declare const settledRunLedger: SettledRunLedger;

/**
 * Process-live advisor seat registry keyed by caller session ID.
 * Coordinates single-flight child session creation, failure latching, and cleanups.
 */
export declare class AdvisorSeatRegistry {
  constructor();
  resetCreateFailure(callerSessionId: string): void;
  ensureSeatChild(
    callerSessionId: string,
    startChild: () => Promise<FSharpResult<string, string>>
  ): Promise<FSharpResult<string, string>>;
  isSeatKnown(callerSessionId: string): boolean;
  hasChildTask(callerSessionId: string): boolean;
  hasCreateFailed(callerSessionId: string): boolean;
  clear(callerSessionId: string): void;
  clearAll(): void;
  snapshot(): SeatRegistrySnapshot;
}

export declare const advisorSeatRegistry: AdvisorSeatRegistry;

export declare namespace AdvisorRegistryLaw {
  const ContractVersion: number;
  const DefaultTimeoutMs: number;
}
