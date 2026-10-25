/**
 * Neutral session execution termination outcome.
 */
export type TerminalOutcome =
  | { readonly tag: "Completed"; readonly fields: [string | undefined, any] }
  | { readonly tag: "Failed"; readonly fields: [any] }
  | { readonly tag: "Aborted"; readonly fields: [any] };

export namespace TerminalOutcome {
  export function Completed(runId: string | undefined, payload: any): TerminalOutcome;
  export function Failed(payload: any): TerminalOutcome;
  export function Aborted(payload: any): TerminalOutcome;
}

export type TerminalCompletionListener = (sessionId: string, outcome: TerminalOutcome) => void;

export interface IDisposable {
  dispose(): void;
  Dispose(): void;
}

/**
 * Autonomous registry for terminal facts, sticky replay cache,
 * idempotence deduplication, and subscriber dispatch.
 */
export class TerminalRegistry {
  constructor(reportFault: (error: Error) => void);
  NotifyTerminal(sessionId: string, outcome: TerminalOutcome): boolean;
  SubscribeTerminal(sessionId: string, listener: TerminalCompletionListener): IDisposable;
  SubscribeFutureTerminal(sessionId: string, listener: TerminalCompletionListener): IDisposable;
  SubscribeProcessTerminal(listener: TerminalCompletionListener): IDisposable;
  SubscribeProcessFutureTerminal(listener: TerminalCompletionListener): IDisposable;
  HasSubscriber(sessionId: string): boolean;
  HasSessionSubscriber(sessionId: string): boolean;
}

/**
 * Autonomous reference-counted bus for sharing TerminalRegistry instances by key.
 */
export class TerminalBus {
  constructor();
  Acquire<T = any>(key: string, candidate: T): T;
  Release<T = any>(key: string, target: T): boolean;
  Count(key: string): number;
}
