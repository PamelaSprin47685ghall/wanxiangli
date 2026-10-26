/**
 * wanxiangli/attachment-lease — which child one Attached kind's lease uses, and what a
 * fresh child owes when its association fails (vibe-fs CUT-12 sub-loop 3;
 * managed-session-lifecycle [001]/[003]; Package-21: in-process lease registry and single-flight).
 */
export interface LeaseChild {
  readonly sessionId: string
  readonly agent?: string | null
  readonly title?: string | null
}

export interface ResolveInput {
  /** The child the kind's durable association names, or null when it has none. */
  readonly restoreHint: string | null
  readonly agent: string
  readonly title: string
  readonly children: readonly LeaseChild[]
}

export type LeaseOrigin = 'Created' | 'Reused' | 'Replacement'

export type ResolveVerdict =
  | { readonly verdict: 'create'; readonly origin: 'Created'; readonly closeReplacedBeforeLink: false }
  | { readonly verdict: 'create'; readonly origin: 'Replacement'; readonly closeReplacedBeforeLink: true }
  | { readonly verdict: 'reuse'; readonly child: string }
  | { readonly verdict: 'reject'; readonly rejection: 'Conflicting' | 'Ambiguous'; readonly child: string }

export declare class AttachmentLeaseLaw {
  readonly contractVersion: 1
  resolve(input: ResolveInput): ResolveVerdict
  /** True for Created and Replacement: a fresh child is aborted when close/link fails. */
  abortOnFailure(origin: LeaseOrigin): boolean
}

export interface StoredLease {
  readonly sessionId: string
  readonly origin: LeaseOrigin | string
  readonly agent: string
}

export interface LeaseOwnerKey {
  readonly owner: string
  readonly kind: string
}

export interface StoredLeaseRecord extends StoredLease, LeaseOwnerKey {}

/**
 * Package-21: In-process lease registry and single-flight coordination owner.
 * Stores bindings by (owner, kind) and coordinates concurrent ensures without duplicate child creation.
 */
export declare class AttachmentLeaseRegistry {
  bind(owner: string, kind: string, lease: StoredLease): void
  tryFind(owner: string, kind: string): StoredLeaseRecord | undefined
  remove(owner: string, kind: string): boolean
  tryFindByChild(childSessionId: string): readonly LeaseOwnerKey[]
  removeByChild(childSessionId: string): readonly LeaseOwnerKey[]
  snapshot(): readonly LeaseOwnerKey[]
  ensure<T>(owner: string, kind: string, start: () => T): T
  finishEnsure(owner: string, kind: string): void
  hasInFlight(owner: string, kind: string): boolean
  inFlightCount(): number
  clear(): void
}

export declare const attachmentLeaseRegistry: AttachmentLeaseRegistry
