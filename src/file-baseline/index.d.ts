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

export interface MaintenanceSummary {
  readonly diffSummary: string
  readonly refresh: boolean
}
export interface TruncatedDiff {
  readonly text: string
  readonly isTruncated: boolean
  readonly notice: string
}
/** 纯文本计算，无需构造 FileBaseline 或提供文件/payload 能力。 */
export declare class FileDiff {
  /** 零上下文统一 diff；null 为 Missing，相同状态返回空串。 */
  fileDiff(path: string, before: string | null, after: string | null): string
  summarize(diffs: readonly string[]): MaintenanceSummary
  /** 只有 ENOENT 代表不存在；其它读取失败不能解释为删除。 */
  readFailure(code: unknown): 'missing' | 'fault'
  /** 保留头尾且不拆代理对；预算小于截断声明时只返回声明。 */
  truncate(diff: string, budget: number): TruncatedDiff
}
