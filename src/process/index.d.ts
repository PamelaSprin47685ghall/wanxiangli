export interface ProcessOptions {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  tailBytes: number;
  maxWriteBytes: number;
}
export interface Failure {
  readonly operation: string;
  readonly code: string | null;
  readonly message: string;
}
export interface ProcessState {
  readonly phase: 'Starting' | 'Running' | 'Draining' | 'Closed';
  readonly pid: number | null;
  readonly exit: { readonly code: number | null; readonly signal: string | null } | null;
  readonly failure: Failure | null;
  readonly stdin: 'Open' | 'Ending' | 'Closed' | 'Failed';
  readonly stdout: { readonly observed: number; readonly retained: number };
  readonly stderr: { readonly observed: number; readonly retained: number };
}
export interface OutputSlice {
  readonly from: number;
  readonly to: number;
  readonly discarded: number;
  readonly bytes: Uint8Array;
  readonly text: string | null;
  readonly textFrom: number;
  readonly textTo: number;
}
export type StartResult = { kind: 'Started'; pid: number } | { kind: 'Failed'; error: Failure };
export type WriteResult = { kind: 'Written'; bytes: number } | { kind: 'Unknown'; error: Failure };
export type SignalName = 'SIGTERM' | 'SIGKILL' | 'SIGINT' | 'SIGHUP';
export type SignalResult =
  | { kind: 'Requested' | 'NotRunning'; signal: SignalName }
  | { kind: 'Failed'; signal: SignalName; error: Failure };
export interface ProcessSession {
  started(): Promise<StartResult>;
  inspect(): ProcessState;
  read(channel: 'stdout' | 'stderr', after: number): OutputSlice;
  write(bytes: Uint8Array): Promise<WriteResult>;
  endInput(): void;
  signal(name: SignalName): SignalResult;
  wait(milliseconds: number): Promise<{ kind: 'Closed' | 'TimedOut'; state: ProcessState }>;
}
export const ProcessSession: { new(options: ProcessOptions): ProcessSession };
