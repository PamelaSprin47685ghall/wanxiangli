/** Handle returned by `run` / `runNaive`. */
export interface SandboxRunHandle {
  readonly programPromise: Promise<string>
  readonly deadlineRef: { current: number }
}

export interface SandboxMessages {
  /**
   * Run modelSource under DONT_CONTEXTIFY + realm membrane.
   * `programPromise` resolves to the wrapper JSON string (sentinels included).
   */
  run(
    api: object,
    deadlineMs: number,
    deadlineEpochMs: number,
    baseClassSource: string,
    modelSource: string,
  ): SandboxRunHandle

  /** Pre-membrane runner — library base-red only; do not use in production. */
  runNaive(
    api: object,
    deadlineMs: number,
    baseClassSource: string,
    modelSource: string,
  ): SandboxRunHandle

  resetDeadline(deadlineRef: { current: number }, epochMs: number): void
}

export function Sandbox(): SandboxMessages
