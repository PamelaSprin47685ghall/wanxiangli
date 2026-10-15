/**
 * wanxiangli/events — §5.0 canonical fact encoding & validation (CUT-18).
 *
 * All operations are pure. No file, SQLite, or Git access lives here.
 * D-04: this codec serves the single-writer SQLite CAS protocol only;
 * multi-writer convergence (fork/adjudication) is a separate protocol.
 */

/**
 * Canonical event input. `id`, `stream`, `type` are required strings;
 * `parents` and `payloadRefs` are string arrays (order-insensitive, deduplicated);
 * `payload` is any JSON value; `payloads` maps payloadRef (sha256 hex) to inline bytes.
 */
export interface EventInput {
  id: string
  stream: string
  type: string
  parents: string[]
  payload: unknown
  payloadRefs: string[]
  payloads?: Record<string, Uint8Array>
}

/** Decoded event; `payloads` values are the decoded inline payload bytes. */
export interface EventOutput {
  id: string
  stream: string
  type: string
  parents: string[]
  payload: unknown
  payloadRefs: string[]
  payloads: Record<string, Uint8Array>
}

export type CodecError =
  | { code: 'IdentityCollision'; eventId: string }
  | { code: 'NonCanonical'; reason: string }
  | { code: 'MalformedEnvelope'; reason: string }
  | { code: 'MissingParent'; eventId: string }
  | { code: 'CyclicParents' }
  | { code: 'MissingPayload'; payloadRef: string }
  | { code: 'UnknownEventType'; eventType: string }

export type DecodeResult =
  | { ok: true; event: EventOutput }
  | { ok: false; error: CodecError }

export type TextResult =
  | { ok: true; text: string }
  | { ok: false; error: CodecError }

export type MergeResult =
  | { ok: true; events: EventOutput[] }
  | { ok: false; error: CodecError }

export type IdentityResult =
  | { ok: true }
  | { ok: false; error: CodecError }

export type ValidateResult =
  | { ok: true; events: EventOutput[]; heads: string[] }
  | { ok: false; error: CodecError }

export declare class CanonicalEventCodec {
  /** Canonical JSON text (no trailing LF) for any JSON value. */
  canonicalJson(value: unknown): string
  /** Encode one event as canonical JSON plus exactly one trailing LF. */
  encode(event: EventInput): string
  /** Decode canonical JSON+LF; re-encoding must reproduce the same bytes. */
  tryDecode(text: string): DecodeResult
  /** Strict UTF-8 text decode; rejects BOM and invalid sequences. */
  tryDecodeUtf8Text(bytes: Uint8Array): TextResult
  /** Strict UTF-8 decode then canonical decode. */
  tryDecodeUtf8(bytes: Uint8Array): DecodeResult
  /** Same id with different canonical bytes → IdentityCollision. */
  checkIdentity(left: EventInput, right: EventInput): IdentityResult
  /** Set-union by id; identical duplicates collapse, collisions fail closed. */
  mergeByIdentity(events: EventInput[]): MergeResult
  /**
   * Full pure validation: vocabulary (explicit predicate), payload closure,
   * identity dedupe, parent closure, acyclicity. Returns merged events and heads.
   */
  validate(events: EventInput[], isKnownEventType: (eventType: string) => boolean): ValidateResult
}
