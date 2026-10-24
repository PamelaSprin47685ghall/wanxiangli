/** Monotone record of external namespaces declared by Host configuration. */
export interface ExternalNamespaceMessages {
  declare(names: readonly string[]): void
  patterns(names: readonly string[]): string[]
  matches(toolName: string): boolean
}

export const ExternalNamespaces: ExternalNamespaceMessages
