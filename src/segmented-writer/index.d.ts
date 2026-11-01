export type FaultPhase = 'before-append' | 'append' | 'open' | 'fsync' | 'close'
export interface Fault {
  readonly phase: FaultPhase
  readonly cause: unknown
}
export type AppendResult =
  | { ok: true; completion: 'no-append' | 'durable' }
  | { ok: false; kind: 'before-append' | 'after-append'; primary: Fault; cleanupFailures: Fault[] }
export interface SegmentedWriterOptions {
  readonly directory: () => string
  readonly writerId: string
  readonly segmentCap: number
}
export declare class SegmentedWriter {
  constructor(options: SegmentedWriterOptions)
  readonly writerId: string
  filePath(): string
  append(text: string): AppendResult
}
