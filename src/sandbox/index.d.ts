/** Handle returned by `run`. */
export interface SandboxRunHandle {
  readonly programPromise: Promise<string>
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

  /**
   * Re-arm the async deadline of a run this object started.
   * The deadline reference stays inside the sandbox; the run is named by handle.
   */
  extendDeadline(handle: SandboxRunHandle, epochMs: number): void
}

export function Sandbox(): SandboxMessages
