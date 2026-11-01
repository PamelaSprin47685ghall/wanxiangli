export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export interface Payloads {
  read(reference: string): Promise<Result<Uint8Array | null>>
  write(bytes: Uint8Array): Promise<Result<string>>
}
export interface FileBaselineOptions {
  readonly resolvePath: (input: string) => string
  readonly payloads: Payloads
}
export interface MaintenanceCapture {
  readonly diffSummary: string
  readonly refresh: boolean
  readonly targetState: string
}
export declare class FileBaseline {
  constructor(options: FileBaselineOptions)
  capture(paths: readonly string[]): Promise<Result<string>>
  compare(paths: readonly string[], baseline: string): Promise<Result<MaintenanceCapture>>
}
