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

export type HistoryResult<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
export interface HistoryRange { readonly start: bigint; readonly end: bigint }
export interface HistoryOpening {
  readonly assignment: string;
  readonly requirements: readonly string[];
  readonly constitutiveBody: '';
}
export interface HistoryPart {
  readonly sequence: bigint;
  readonly role: string;
  readonly kind: string;
  readonly toolName: string | null;
  readonly bodyRef: string;
  readonly bodyDigest: string;
  readonly descriptor: string;
  readonly metadata: unknown;
}
export type HistoryPartInput = Omit<HistoryPart, 'metadata'> & { readonly metadata?: unknown };
export type HistoryReadEntry = Omit<HistoryPart, 'descriptor'> & { readonly descriptor?: string };
export interface HistoryTerminal {
  readonly providerRun: string;
  readonly bodyRef: string;
  readonly bodyDigest: string;
  readonly frontier: bigint;
}
export type HistoryRejection =
  | { readonly kind: 'OpeningAlreadyCaptured' }
  | { readonly kind: 'CursorNotAfterHead'; readonly expected: bigint; readonly actual: bigint }
  | { readonly kind: 'TerminalAlreadyCaptured' };
export type SemanticPart =
  | { readonly kind: 'text' | 'reasoning' | 'tool_result'; readonly text: string }
  | { readonly kind: 'tool_call'; readonly name: string; readonly args: string }
  | { readonly kind: 'media'; readonly mediaType: string | null; readonly digest: string };
export interface HistoryItem {
  readonly sequence: bigint;
  readonly role: string;
  readonly part: SemanticPart;
  readonly metadata: unknown;
}
export type HistoryBodyReader = (reference: string) => Promise<HistoryResult<string, string>>;
export interface TraceHistory {
  appendOpening(input: { readonly assignment: string; readonly requirements: readonly string[] }): HistoryResult<TraceHistory, HistoryRejection>;
  appendPart(input: HistoryPartInput, prepareMetadata?: () => unknown): HistoryResult<TraceHistory, HistoryRejection>;
  appendTerminal(input: Omit<HistoryTerminal, 'frontier'>): HistoryResult<TraceHistory, HistoryRejection>;
  entries(): HistoryPart[];
  terminals(): HistoryTerminal[];
  opening(): HistoryOpening | null;
  latestTerminal(): HistoryTerminal | null;
  terminalFor(providerRun: string): HistoryTerminal | null;
  headSequence(): bigint;
  head(): bigint;
  latestSequence(): bigint | null;
  rangeFrom(start: bigint): HistoryRange;
  slice(range: HistoryRange): HistoryPart[];
  interval(range: HistoryRange): { readonly after: Cut; readonly through: Cut };
  afterCoverage(sequence: bigint): { readonly after: Cut; readonly through: Cut };
  cutAt(sequence: bigint): Cut;
  headCut(): Cut;
  records(): string[];
  read(entries: readonly HistoryReadEntry[], readBody: HistoryBodyReader): Promise<HistoryResult<HistoryItem[], string>>;
  materialize(range: HistoryRange, readBody: HistoryBodyReader): Promise<HistoryResult<HistoryItem[], string>>;
}
export const TraceHistory: { new(traceId: string): TraceHistory };
export function materializeTraceItems(range: HistoryRange, items: readonly HistoryItem[]): HistoryItem[];
export function inspectTraceItems(traceId: string, openingText: string | null, range: HistoryRange, items: readonly HistoryItem[]): {
  readonly traceId: string;
  readonly head: Cut;
  readonly after: Cut;
  readonly through: Cut;
  readonly records: string[];
  readonly window: TraceWindow;
  readonly materializedCount: number;
};
