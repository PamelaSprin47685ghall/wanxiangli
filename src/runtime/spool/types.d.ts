export interface SpoolOptions {
  /** Absolute existing directory that receives the spool file once memory is exceeded. */
  directory: string;
  /** Bytes held in memory before every byte moves to one file, 0..16777216. */
  memoryBytes: number;
}
export interface Failure {
  readonly operation: string;
  readonly code: string | null;
  readonly message: string;
}
export type Channel = 'stdout' | 'stderr';
export type AppendResult = { readonly kind: 'Memory' | 'File' | 'Finished' } | { readonly kind: 'Failed'; readonly error: Failure };
export interface SpoolState {
  readonly phase: 'Memory' | 'File' | 'Failed' | 'Finished';
  readonly observed: number;
  readonly written: number;
  readonly held: number;
  readonly path: string | null;
  readonly failure: Failure | null;
}
export type SpoolResult =
  | { readonly kind: 'Memory'; readonly observed: number; readonly stdout: Uint8Array; readonly stderr: Uint8Array }
  | { readonly kind: 'File'; readonly observed: number; readonly path: string; readonly bytes: number }
  | { readonly kind: 'Failed'; readonly observed: number; readonly written: number; readonly path: string | null; readonly error: Failure };
export type DiscardResult = { readonly kind: 'Removed' | 'Absent' } | { readonly kind: 'Failed'; readonly error: Failure };
export type ReadResult = { readonly kind: 'Read'; readonly bytes: number } | { readonly kind: 'Failed'; readonly error: Failure };
export type TailResult =
  | { readonly kind: 'Tail'; readonly observed: number; readonly truncated: boolean; readonly discarded: number; readonly bytes: Uint8Array }
  | { readonly kind: 'Failed'; readonly error: Failure };
export interface OutputSpool {
  append(channel: Channel, bytes: Uint8Array): AppendResult;
  inspect(): SpoolState;
  finish(): SpoolResult;
  discard(): DiscardResult;
}
export const OutputSpool: {
  new(options: SpoolOptions): OutputSpool;
  readChunks(path: string, chunkBytes: number, consume: (bytes: Uint8Array) => void | Promise<void>): Promise<ReadResult>;
  readTail(path: string, limitBytes: number): Promise<TailResult>;
};
