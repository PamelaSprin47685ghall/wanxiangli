/**
 * wanxiangli/casebook-access — Casebook 实质访问与会话观测累积（CUT-27 / Package-06）。
 */
export type AccessKind = 'read' | 'create' | 'edit' | 'delete' | 'move' | 'mutation' | 'grep' | 'glob' | 'list' | 'stat' | 'mention'

export type Access =
  | { readonly kind: 'read' | 'create' | 'edit' | 'delete' | 'grep' | 'glob' | 'list' | 'stat' | 'mention'; readonly path: string }
  | { readonly kind: 'move'; readonly source: string; readonly destination: string }
  | { readonly kind: 'mutation'; readonly path: string; readonly committed: boolean }

export declare class CasebookAccessLaw {
  /** 一次已发生的访问计入 relatedPaths 的路径；检索、列表、提及与未提交的修改不计。 */
  accessPaths(access: Access): string[]
  /** 工具结果 → 路径：已提交的 create/rewrite/delete（参数 path|filePath|file 的第一个出现者）与 move（两端）。 */
  toolPaths(toolName: string, args: unknown, committed: boolean): string[]
  isSubstantiveTool(toolName: string): boolean
  /** 去空白、去重、码元序升序。 */
  relatedPaths(paths: readonly string[]): string[]
  /** cat/head/tail/sed 的单文件读取目标；命令替换或非读取命令为 null。 */
  execRead(command: string): string | null
}

/** CASE-003: 归一化后的文件读取观测（去除了冗余的 kind 字段）。 */
export interface CasebookFileRead {
  readonly path: string
  readonly contentHash: string
}

/** KR-003: 纯内存实质文件访问跟踪器（不触碰文件系统与事件存储）。 */
export declare class AccessTracker {
  recordRead(path: string, contentHash: string): void
  recordCreate(path: string): void
  recordEdit(path: string): void
  recordDelete(path: string): void
  recordMove(source: string, destination: string): void
  recordGrep(pattern: string, path: string): void
  recordGlob(pattern: string): void
  recordAttemptedMutation(path: string, committed: boolean): void
  getRelatedPaths(): string[]

  RecordRead(path: string, contentHash: string): void
  RecordCreate(path: string): void
  RecordEdit(path: string): void
  RecordDelete(path: string): void
  RecordMove(source: string, destination: string): void
  RecordGrep(pattern: string, path: string): void
  RecordGlob(pattern: string): void
  RecordAttemptedMutation(path: string, committed: boolean): void
  GetRelatedPaths(): string[]
}

/** CASE-003 / KR-003: 会话级观测与实质性访问累积器。 */
export declare class CasebookObservationCollector {
  getTracker(sessionId: string): AccessTracker
  Collect(sessionId: string, toolName: string, args: unknown, output: string): void
  RecordFileRead(sessionId: string, path: string, output: string, contentHash?: string): void
  Drain(sessionId: string): CasebookFileRead[]
  Count(sessionId: string): number
}

export declare const casebookObservationCollector: CasebookObservationCollector
