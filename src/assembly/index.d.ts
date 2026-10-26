import type { Command, Decision, Effect, EffectAsk, EffectDispatch, EffectLaunch, EffectStop, Frame, Recovery, Snapshot } from 'wanxiangli/work';
import type { AppendResult } from 'wanxiangli/eventstore';

export type Awaitable<T> = T | Promise<T>;

export interface SessionReceipt {
  status: 'SessionCreated';
  execSessionId: string;
}
export interface UnknownReceipt {
  status: 'Unknown';
}
export interface NotStartedReceipt {
  status: 'NotStarted';
  reason: string;
}

export interface EffectPorts {
  ask(effect: EffectAsk): Awaitable<'Parked' | 'Unknown'>;
  dispatch(effect: EffectDispatch): Awaitable<'Sent' | 'Unknown'>;
  createSession(effect: EffectLaunch): Awaitable<SessionReceipt | UnknownReceipt | NotStartedReceipt>;
  sendDraft(effect: EffectLaunch): Awaitable<'Admitted' | 'Unknown'>;
  stop(effect: EffectStop): Awaitable<'Requested' | 'Unknown'>;
}

export interface Journal {
  read(stream: string): string[];
  append(stream: string, expectedRevision: number, requestId: string, body: string): AppendResult;
}

export type DurableResult =
  | { status: 'Committed' | 'Replayed' | 'Observed'; revision: number; result: Decision; reason: null }
  | { status: 'Conflict' | 'NotWritten' | 'Unknown'; revision: number; result: null; reason: string | null };

export type DurableRecovery = Recovery | { next: 'ObserveCommit'; requestId: string; state: null };

export interface DurableWork {
  execute(requestId: string, command: Command): DurableResult;
  inspect(): Snapshot;
  history(): Frame[];
  records(): string[];
  recover(): DurableRecovery;
}
export const DurableWork: { new(workId: string, journal: Journal, effects?: EffectPorts): DurableWork };
export type { Effect };
