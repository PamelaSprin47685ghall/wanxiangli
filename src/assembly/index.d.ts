import type { Command, Decision, Frame, Recovery, Snapshot } from 'wanxiangli/work';
import type { AppendResult } from 'wanxiangli/eventstore';

export interface Journal {
  read(stream: string): string[];
  append(stream: string, expectedRevision: number, requestId: string, body: string): AppendResult;
}

export type DurableResult =
  | { status: 'Committed' | 'Replayed' | 'Observed'; revision: number; result: Decision; reason: null }
  | { status: 'Conflict' | 'NotWritten' | 'Unknown'; revision: number; result: null; reason: string | null; ok?: false };

export type DurableRecovery = Recovery | { next: 'ObserveCommit'; requestId: string; state: null };

export interface DurableWork {
  execute(requestId: string, command: Command): DurableResult;
  inspect(): Snapshot;
  history(): Frame[];
  records(): string[];
  recover(): DurableRecovery;
}
export const DurableWork: { new(workId: string, journal: Journal): DurableWork };
