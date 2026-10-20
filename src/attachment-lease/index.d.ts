/**
 * wanxiangli/attachment-lease — which child one Attached kind's lease uses, and what a
 * fresh child owes when its association fails (vibe-fs CUT-12 sub-loop 3;
 * managed-session-lifecycle [001]/[003]).
 *
 * Pure computation. The caller lists the owner's children, performs create / close /
 * link / abort and owns the lease registry and its single-flight.
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
