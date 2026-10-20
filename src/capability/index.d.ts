/**
 * wanxiangli/capability — 角色 × 能力的唯一事实。
 *
 * 可见工具面与运行时门禁读同一份结果；角色以规范小写标签进入，
 * 矩阵之外的标签（历史角色、内部槽位、未知名）一律空集，失败关闭。
 */

export type PermissionLabel =
  | 'Fork' | 'Resume' | 'Join' | 'Horizon' | 'Fission' | 'Read' | 'Write' | 'Edit'
  | 'Glob' | 'Grep' | 'Move' | 'Remove' | 'Exec' | 'Pty' | 'ReviewAssessment' | 'Fetch'
  | 'Finality' | 'BashHoneypot' | 'JsPlan' | 'Ask' | 'Deliver' | 'Review'
  | 'DevOpsConsultation' | 'Advisor'

export interface ManagerFacts {
  hasActiveIncumbency: boolean
  hasAssessment: boolean
  hasConfirmation: boolean
  isFinalIncumbent: boolean
  hasCleanupBlocker: boolean
}

export declare class Capability {
  permissionLabels(): PermissionLabel[]
  /** 排序后的能力标签；非规范角色一律 []。 */
  permissions(role: unknown): PermissionLabel[]
  isAllowed(role: unknown, permission: unknown): boolean
  managerReviewReadOnlyPermissions(): PermissionLabel[]
  managerFinishPermissions(): PermissionLabel[]
  permissionsForManagerFacts(facts: ManagerFacts): PermissionLabel[]
  /** 能力 → 宿主工具名；空数组表示只在编程面上。未知能力 []。 */
  toolNames(permission: unknown): string[]
  /** 工具名 → 该角色视角下的能力；共名时取角色持有的一项，无法唯一确定时 null/undefined。 */
  permissionOfToolName(role: unknown, name: unknown): PermissionLabel | null | undefined
  /** 可见即可做：角色持有该名字映射到的能力。 */
  admitsToolForRole(role: unknown, name: unknown): boolean
  /** 宿主实用工具名（不是办公能力）：['skill', 'assume']。 */
  utilityToolNames(): string[]
  /** 实用工具准入：现行角色持有；历史/内部/未知角色与非实用工具名一律 false。 */
  admitsUtility(role: unknown, name: unknown): boolean
}
