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
export type OutputReceiver = (channel: 'stdout' | 'stderr', bytes: Uint8Array) => void;
export const ProcessSession: { new(options: ProcessOptions, onOutput?: OutputReceiver): ProcessSession };

export interface ProcessRunRequest {
  readonly command: {
    readonly fileName: string;
    readonly args: readonly string[];
    readonly cwd?: string | null;
    readonly env?: Readonly<Record<string, string>> | null;
    readonly stdin?: string | null;
  };
  readonly estimate: {
    readonly runtimeSeconds: number;
    /** 转文件阈值，内存上限另封顶为 204800 字节；不截断、不因输出多而杀进程。 */
    readonly outputBytes: bigint;
    readonly memory: 'medium' | 'large';
  };
  readonly context?: {
    readonly cwd?: string | null;
    /** 默认一小时；实际期限为 estimate 与此值的较小者，从启动成功后开始计算。 */
    readonly hardLimitMs?: number;
    readonly spoolDirectory?: string;
  };
}

export type ProcessRunResult =
  | { readonly ok: true; readonly value:
      | { readonly kind: 'Completed'; readonly exitCode: number; readonly stdout: string; readonly stderr: string; readonly spooled: false }
      | { readonly kind: 'Spooled'; readonly exitCode: number; readonly spoolPath: string; readonly totalBytes: bigint; readonly chunkCount: number }
    }
  | { readonly ok: false; readonly error:
      | { readonly kind: 'TimeoutExceeded'; readonly durationMs: number }
      | { readonly kind: 'SpawnFailed' | 'ProcessCancelled' | 'ExecutionFailed'; readonly reason: string }
    };

/** 一次命令的完整结果。Large 排队取消仍拒绝 Promise；成功 spool 由调用方读后删除。 */
export function runProcess(request: ProcessRunRequest, signal?: AbortSignal): Promise<ProcessRunResult>;
