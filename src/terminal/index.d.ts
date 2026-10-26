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

/**
 * Neutral cancelable deadline handle for visibility wait backstop.
 */
export interface DeadlineHandle {
  readonly Delay: Promise<void>;
  readonly delay?: Promise<void>;
  Cancel(): void;
  cancel?(): void;
}

export type DelayFactory = (budgetMilliseconds: number) => DeadlineHandle | { Delay?: Promise<void>; delay?: Promise<void>; Cancel?: () => void; cancel?: () => void };

export interface TimerPortLike {
  Delay(ms: number): any;
  Dispose?(): void;
}

/**
 * Autonomous hub for event-driven projection visibility catch-up.
 * Waiters are per-session one-shot completions with a deadline backstop.
 */
export class MessageVisibilityHub {
  constructor(timerArg?: DelayFactory | TimerPortLike);
  Notify(sessionId: string): void;
  notify(sessionId: string): void;
  AwaitChange(sessionId: string, budgetMilliseconds: number): Promise<void>;
  awaitChange(sessionId: string, budgetMilliseconds: number): Promise<void>;
  PendingCount(sessionId: string): number;
  pendingCount(sessionId: string): number;
  Clear(sessionId: string): void;
  clear(sessionId: string): void;
  ClearAll(): void;
  clearAll(): void;
}

export const messageVisibilityHub: MessageVisibilityHub;
