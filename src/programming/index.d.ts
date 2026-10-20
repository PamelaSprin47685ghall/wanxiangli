/** wanxiangli/programming — JS programming-surface projection law (CUT-25). */

export interface RoleSurface {
  readonly toolName: string
  readonly capabilities: string[]
  readonly members: string[]
}

export interface ProgrammingMessages {
  projectPermission(label: unknown): string | null
  projectPermissions(labels: unknown): string[]
  admitsSurface(labels: unknown): boolean
  toolNameFor(role: unknown): string
  membersFor(jsCapabilities: unknown, roleName: unknown): string[]
  projectRole(role: unknown, officePermissions: unknown): RoleSurface | null
}

export function Programming(): ProgrammingMessages
