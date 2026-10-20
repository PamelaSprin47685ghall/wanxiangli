/**
 * wanxiangli/casebook-access — Casebook 实质访问的纯分类（CUT-27 子范围③，knowledge-reuse-003/010）。
 *
 * 纯计算：不读文件、不持有会话状态、不写事件。每会话的累积器、Observation 的构造与内容摘要都归调用方。
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
