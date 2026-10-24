export interface Failure {
  readonly operation: string;
  readonly code: string | null;
  readonly message: string;
}
/** A spawn function with bun-pty's shape: spawn(file, args, { name, cols, rows, cwd }). */
export type PtyDriver = (file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string }) => unknown;
export interface TerminalOptions {
  /** The PTY driver chosen by the composer (bun-pty `spawn` under Bun). */
  driver: PtyDriver;
  /** Shell command run as `sh -lc command`; non-empty, well-formed, no NUL. */
  command: string;
  /** Absolute existing directory. */
  cwd: string;
  cols: number;
  rows: number;
}
export type SignalName = 'TERM' | 'KILL' | 'INT' | 'HUP' | 'QUIT' | 'USR1' | 'USR2';
export interface TerminalExit {
  readonly exitCode: number | null;
  /** bun-pty does not report the terminating signal; null under that driver. */
  readonly signal: string | null;
}
export type OpenResult = { readonly kind: 'Opened'; readonly terminal: Terminal } | { readonly kind: 'Failed'; readonly error: Failure };
export type CommandResult<K extends string> = { readonly kind: K | 'Closed' } | { readonly kind: 'Failed'; readonly error: Failure };
export type ReadResult = { readonly kind: 'Read'; readonly output: string; readonly closed: boolean } | { readonly kind: 'Busy' };
export type CloseResult =
  | { readonly kind: 'Exited'; readonly escalated: boolean; readonly exit: TerminalExit }
  | { readonly kind: 'AlreadyExited'; readonly exit: TerminalExit }
  | { readonly kind: 'Unconfirmed'; readonly pid: number };
export interface TerminalState {
  readonly phase: 'Open' | 'Exited';
  readonly pid: number;
  readonly buffered: number;
  readonly exit: TerminalExit | null;
}
export interface Terminal {
  write(text: string): CommandResult<'Written'>;
  /** Drains buffered output; when empty and open, waits up to waitMs (0..60000) for the first byte. */
  read(waitMs: number): Promise<ReadResult>;
  signal(name: SignalName): CommandResult<'Sent'>;
  resize(cols: number, rows: number): CommandResult<'Resized'>;
  wait(): Promise<TerminalExit>;
  /** TERM the process group, wait graceMs, KILL if needed, then sweep the group. */
  close(graceMs: number): Promise<CloseResult>;
  inspect(): TerminalState;
}
export const Terminal: {
  open(options: TerminalOptions): OpenResult;
};
