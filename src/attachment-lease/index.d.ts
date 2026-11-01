/**
 * Child-session selection, shared establishment, reuse, and retirement.
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
 * In-process lease registry and single-flight coordination owner.
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

export type AttachmentResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

export interface AttachmentSessionLease {
  readonly sessionId: string
  readonly origin: LeaseOrigin
  readonly agent: string
}

export interface AttachedSessionRequest extends LeaseOwnerKey {
  readonly agent: string
  readonly directory: string | null
}

export interface AssociatedSessionRequest extends AttachedSessionRequest {
  readonly title: string
  readonly restoreHint: string | null
}

export interface AttachmentCreateRequest {
  readonly owner: string
  readonly agent: string
  readonly directory: string | null
}

export interface AttachmentLinkRequest {
  readonly owner: string
  readonly sessionId: string
  readonly agent: string
}

export interface AttachedSessionEffects {
  isUsable(sessionId: string): boolean
  /** The adapter supplies an exact match or no association; observation errors stay errors. */
  observe(request: LeaseOwnerKey & { readonly agent: string }): Promise<AttachmentResult<string | null>>
  create(request: AttachmentCreateRequest): Promise<AttachmentResult<string>>
  link(request: AttachmentLinkRequest): Promise<AttachmentResult<void>>
}

export interface AttachmentRetireEffects {
  abort(request: { readonly sessionId: string }): Promise<AttachmentResult<void>>
  close(request: { readonly owner: string }): Promise<AttachmentResult<void>>
}

export interface AssociatedSessionEffects extends AttachmentRetireEffects {
  list(request: { readonly owner: string }): Promise<AttachmentResult<readonly LeaseChild[]>>
  create(request: AttachmentCreateRequest): Promise<AttachmentResult<string>>
  link(request: AttachmentLinkRequest): Promise<AttachmentResult<void>>
  rejection(request: LeaseOwnerKey & {
    readonly child: string
    readonly rejection: 'Conflicting' | 'Ambiguous'
  }): string
}

/** Cooperates through the supplied registry; it owns no second binding or flight table. */
export declare class AttachmentSessions {
  constructor(registry: AttachmentLeaseRegistry)
  /** Reuses a usable binding with its original agent. Observation failure retains the flight. */
  getOrCreate(request: AttachedSessionRequest, effects: AttachedSessionEffects): Promise<AttachmentResult<AttachmentSessionLease>>
  /** Observes the association on each call; clears its flight when establishment settles. */
  ensureAssociated(request: AssociatedSessionRequest, effects: AssociatedSessionEffects): Promise<AttachmentResult<AttachmentSessionLease>>
  /** Aborts, closes, then removes the binding. A rejected operation stops this sequence. */
  retireAssociated(owner: string, kind: string, effects: AttachmentRetireEffects): Promise<AttachmentResult<void>>
  tryFind(owner: string, kind: string, isUsable: (sessionId: string) => boolean): AttachmentSessionLease | null
  tryFindOwner(sessionId: string, kind: string): string | null
  remove(owner: string, kind: string): boolean
  removeByChild(sessionId: string): boolean
  /** Removes bindings for these kinds without clearing any flight or another kind. */
  clearKinds(kinds: readonly string[]): void
}
