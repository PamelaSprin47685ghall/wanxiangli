/**
 * wanxiangli/advisor — advisor consult laws (CUT-39).
 *
 * Material identity, the follow-up delta over a caller-generated view, the per-caller
 * delivered-material ledger, and prose read-back. Pure except for the ledger, which is
 * process-live state owned by its instance. The host keeps view generation (anchor
 * ledger, report mapping), TOML rendering, the advisor child session and its dispatch.
 */

export interface Material {
  /** Representative anchor: a non-negative integer; 0 is the implicit opening. */
  readonly anchor: number
  readonly text: string
}

export interface ConsultPlan {
  /** Material not yet delivered, in view order. */
  readonly delta: readonly Material[]
  /** Distinct anchors of the whole view, in view order. */
  readonly deliveredAnchors: readonly number[]
  /** Identities of `delta`; record them only after a consult succeeded. */
  readonly deliveredMaterial: readonly string[]
  readonly hasNewMaterial: boolean
}

export interface ProseMessage {
  readonly role: string
  readonly text: string
}

export declare class AdvisorLaw {
  readonly contractVersion: 1
  /** `${anchor}:${text.length}:${text}` (UTF-16 length). Throws on a malformed anchor or text. */
  materialKey(anchor: number, text: string): string
  /** Filter the complete view by delivered identities; never filters the input before generation. */
  plan(delivered: readonly string[], material: readonly Material[]): ConsultPlan
  /** Last non-blank assistant text (role matched case-insensitively), or null. */
  answer(messages: readonly ProseMessage[]): string | null
  /** A fresh, empty ledger; ledgers never share state. */
  ledger(): AdvisorLedger
}

export interface AdvisorLedger {
  /** Delivered identities of this caller, ordinal-sorted; [] when unknown. */
  delivered(caller: string): string[]
  /** Monotone union; an empty list changes nothing. */
  record(caller: string, keys: readonly string[]): void
  clear(caller: string): void
  clearAll(): void
}
