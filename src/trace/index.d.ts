export type Origin = 'human' | 'plugin' | 'host-internal' | 'provider';
export type Role = 'user' | 'assistant' | 'tool' | 'system';
export type PartKind = 'text' | 'tool-call' | 'tool-result' | 'binary';
export type Observation =
  | { type: 'Opening'; bytes: Uint8Array }
  | { type: 'RunStarted'; runId: string }
  | ({ type: 'MessageObserved'; messageId: string } & (
      | { role: 'user'; origin: 'human' | 'plugin' | 'host-internal'; runId: null }
      | { role: 'system'; origin: 'plugin' | 'host-internal'; runId: null }
      | { role: 'assistant' | 'tool'; origin: 'provider'; runId: string }))
  | { type: 'PartConfirmed'; messageId: string; partId: string; index: number; kind: PartKind; bytes: Uint8Array }
  | { type: 'MessageFinished'; messageId: string; partCount: number }
  | { type: 'RunFinished'; runId: string; outcome: 'Completed' | 'Failed' | 'Cancelled' };
export interface CaptureResult {
  readonly status: 'Appended' | 'Replayed';
  readonly cursor: number;
  readonly record: string;
}
export interface Cut {
  readonly traceId: string;
  readonly cursor: number;
  readonly digest: string;
}
export interface ByteContent {
  readonly bytes: Uint8Array;
  readonly text: string | null;
}
type ByteObservation = Extract<Observation, { bytes: Uint8Array }>;
export type ObservationView = Exclude<Observation, ByteObservation>
  | { type: 'Opening'; content: ByteContent }
  | { type: 'PartConfirmed'; messageId: string; partId: string; index: number; kind: PartKind; content: ByteContent };
export interface MessageView {
  readonly messageId: string;
  readonly role: Role;
  readonly origin: Origin;
  readonly runId: string | null;
  readonly firstCursor: number;
  readonly finished: boolean;
  readonly parts: readonly {
    readonly partId: string; readonly index: number; readonly kind: PartKind;
    readonly cursor: number; readonly content: ByteContent;
  }[];
}
export interface TraceWindow {
  readonly after: Cut;
  readonly through: Cut;
  readonly opening: ByteContent | null;
  readonly messages: readonly MessageView[];
  readonly originals: readonly MessageView[];
  readonly statement: null | {
    readonly messageId: string;
    readonly partIds: readonly string[];
    readonly content: ByteContent;
  };
}
export interface Trace {
  capture(observation: Observation): CaptureResult;
  inspect(): { readonly traceId: string; readonly cursor: number; readonly messages: number; readonly runs: number; readonly bytes: number };
  records(): string[];
  head(): Cut;
  cut(cursor: number): Cut;
  read(after: Cut, through: Cut): { readonly cursor: number; readonly observation: ObservationView }[];
  materialize(after: Cut, through: Cut): TraceWindow;
}
export const Trace: { new(traceId: string, records?: readonly string[]): Trace };
